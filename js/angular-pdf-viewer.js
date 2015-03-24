/*
 * angular-pdf-viewer v1.1.0
 * https://github.com/jdryg/angular-pdf-viewer
 */
(function (angular, PDFJS, document) {
	"use strict";

	angular.module("angular-pdf-viewer", []).
	directive("pdfViewer", [function () {
		// HACK: A LUT for zoom levels because I cannot find a formula that works in all cases.
		var zoomLevelsLUT = [
			0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 
			1.0, 1.1, 1.3, 1.5, 1.7, 1.9, 
			2.0, 2.2, 2.4, 2.6, 2.8, 
			3.0, 3.3, 3.6, 3.9,
			4.0, 4.5,
			5.0
		];

		var pageMargin = 10;

		function trim1 (str) {
			return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
		}

		return {
			restrict: "E",
			scope: {
				src: "@",
				file: "=",
				api: "=",
				initialScale: "@",
				renderTextLayer: "@",
				progressCallback: "&",
				passwordCallback: "&",
				searchTerm: "@",
				searchResultId: "=",
				searchNumOccurences: "=",
				currentPage: "="
			},
			controller: ['$scope', '$element', function ($scope, $element) {
				$scope.pdf = null;
				$scope.pages = [];
				$scope.scale = 1.0;
				$scope.fitWidthScale = 1.0;
				$scope.fitPageScale = 1.0;
				$scope.searchResults = [];

				$scope.getContainerSize = function () {
					// Create a tall temp element, add it to the $element
					// and calculate its width. This way we can take into account 
					// the scrollbar width.
					// NOTE: Even if the PDF can fit in a single screen (e.g. 1 
					// page at really small scale level), assuming there will be
					// a scrollbar, doesn't hurt. The page div will be so small 
					// that the difference between left and right margins will not
					// be distinguisable.
					var tallTempElement = angular.element("<div></div>");
					tallTempElement.css("height", "10000px");
					$element.append(tallTempElement);

					var w = tallTempElement[0].offsetWidth;

					tallTempElement.remove();

					var h = $element[0].offsetHeight;
					if(h === 0) {
						// TODO: Should we get the parent height?
						h = 2 * pageMargin;
					}

					// HACK: Allow some space around page.
					// Q: Should this be configurable by the client?
					w -= 2 * pageMargin;
					h -= 2 * pageMargin;

					return {
						width: w,
						height: h
					};
				};

				$scope.downloadProgress = function (progressData) {
					// JD: HACK: Sometimes (depending on the server serving the PDFs) PDF.js doesn't
					// give us the total size of the document (total == undefined). In this case,
					// we guess the total size in order to correctly show a progress bar if needed (even
					// if the actual progress indicator will be incorrect).
					var total = 0;
					if (typeof progressData.total === "undefined") {
						while (total < progressData.loaded) {
							total += 1024 * 1024;
						}
					} else {
						total = progressData.total;
					}

					// Inform the client about the progress...
					if ($scope.progressCallback) {
						$scope.$apply(function () {
							$scope.progressCallback({ 
								operation: "download",
								state: "loading", 
								value: progressData.loaded, 
								total: total,
								message: ""
							});
						});
					}
				};

				$scope.getPDFPassword = function (passwordFunc, reason) {
					var password = "";
					if($scope.passwordCallback) {
						$scope.$apply(function () {
							password = $scope.passwordCallback({reason: reason});

							if(password !== "" && password !== undefined && password !== null) {
								passwordFunc(password);
							} else {
								if ($scope.progressCallback) {
									$scope.progressCallback({ 
										operation: "render",
										state: "failed", 
										value: 1, 
										total: 0,
										message: "A password is required to read this document."
									});
								}
							}
						});
					} else {
						if ($scope.progressCallback) {
							$scope.progressCallback({ 
								operation: "render",
								state: "failed", 
								value: 1, 
								total: 0,
								message: "A password is required to read this document."
							});
						}
					}
				};
				
				$scope.createPage = function (page, textContent) {
					var pageContainer = angular.element("<div></div>");
					pageContainer.addClass("page");
					pageContainer.attr("id", "page_" + page.pageIndex);

					var canvasElement = angular.element("<canvas></canvas>");
					var textLayerElement = angular.element("<div></div>");
					textLayerElement.addClass("text-layer");

					return {
						id: page.pageIndex + 1,
						pdfPage: page,
						textContent: textContent,
						container: pageContainer,
						canvas: canvasElement,
						textLayer: textLayerElement,
						rendered: false
					};
				};

				$scope.shouldRenderTextLayer = function () {
					if($scope.renderTextLayer === "" || $scope.renderTextLayer === undefined || $scope.renderTextLayer === null || $scope.renderTextLayer.toLowerCase() === "false") {
						return false;
					}

					return true;
				};

				$scope.getAllPDFPages = function (pdf, callback) {
					var pageList = [];

					var remainingPages = pdf.numPages;
					if($scope.shouldRenderTextLayer()) {
						for(var iPage = 0;iPage < pdf.numPages;++iPage) {
							pageList.push({});

							var getPageTask = pdf.getPage(iPage + 1);
							getPageTask.then(function (page) {
								var textContentTask = page.getTextContent();
								textContentTask.then(function (textContent) {
									pageList[page.pageIndex] = $scope.createPage(page, textContent);

									--remainingPages;
									if(remainingPages === 0) {
										callback(pageList);
									}
								});
							});
						}
					} else {
						for(var iPage = 0;iPage < pdf.numPages;++iPage) {
							pageList.push({});

							var getPageTask = pdf.getPage(iPage + 1);
							getPageTask.then(function (page) {
								pageList[page.pageIndex] = $scope.createPage(page, null);

								--remainingPages;
								if(remainingPages === 0) {
									callback(pageList);
								}
							});
						}
					}
				};

				$scope.clearPreviousHighlight = function () {
					if($scope.searchResultId <= 0 || $scope.searchResultId > $scope.searchResults.length) {
						return;
					}

					var result = $scope.searchResults[$scope.searchResultId - 1];
					if(result === null) {
						return;
					}

					var textLayer = $scope.pages[result.pageID].textLayer;
					if(textLayer === null) {
						return;
					}

					var textDivs = textLayer.children();
					if(textDivs === null || textDivs.length === 0) {
						return;
					}

					if(result.itemID < 0 || result.itemID >= textDivs.length) {
						return;
					}

					var item = textDivs[result.itemID];
					if(item.childNodes.length !== 3) {
						return;
					}

					item.replaceChild(item.childNodes[1].firstChild, item.childNodes[1]);
					item.normalize();
				};

				$scope.highlightItemInPage = function (pageID, itemID, matchPos, text) {
					var textLayer = $scope.pages[pageID].textLayer;
					if(textLayer === null) {
						return;
					}

					var textDivs = textLayer.children();
					var item = textDivs[itemID];

					var before = item.childNodes[0].nodeValue.substr(0, matchPos);
					var middle = item.childNodes[0].nodeValue.substr(matchPos, text.length);
					var after = document.createTextNode(item.childNodes[0].nodeValue.substr(matchPos + text.length));
					
					var highlight_span = document.createElement("span");
					highlight_span.className = "highlight";

					highlight_span.appendChild(document.createTextNode(middle));

					item.childNodes[0].nodeValue = before;
					item.childNodes[0].parentNode.insertBefore(after, item.childNodes[0].nextSibling);
					item.childNodes[0].parentNode.insertBefore(highlight_span, item.childNodes[0].nextSibling);
					
					item.scrollIntoView();
				};

				$scope.highlightSearchResult = function (resultID) {
					$scope.clearPreviousHighlight();

					if(resultID < 0 || resultID >= $scope.searchResults.length) {
						return;
					}

					var result = $scope.searchResults[resultID];
					if(result.pageID < 0 || result.pageID >= $scope.pages.length) {
						return;
					}

					if(!$scope.pages[result.pageID].rendered) {
						$scope.renderPDFPage(result.pageID, $scope.scale, function () {
							$scope.highlightItemInPage(result.pageID, result.itemID, result.matchPos, $scope.searchTerm);
							$scope.searchResultId = resultID + 1;
						});
					} else {
						$scope.highlightItemInPage(result.pageID, result.itemID, result.matchPos, $scope.searchTerm);
						$scope.searchResultId = resultID + 1;
					}
				};
				
				$scope.resetSearch = function () {
					$scope.clearPreviousHighlight();
					$scope.searchResults = [];
					$scope.searchResultId = 0;
					$scope.searchNumOccurences = 0;
					$scope.searchTerm = "";
				};

				$scope.searchPDF = function (text) {
					if(!$scope.shouldRenderTextLayer()) {
						return 0;
					}

					$scope.clearPreviousHighlight();
					$scope.resetSearch();
					
					$scope.searchTerm = text;

					var regex = new RegExp(text, "i");

					var numPages = $scope.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						var pageTextContent = $scope.pages[iPage].textContent;
						if(pageTextContent === null) {
							continue;
						}

						var numItems = pageTextContent.items.length;
						var numItemsSkipped = 0;
						for(var iItem = 0;iItem < numItems;++iItem) {
							// Find all occurrences of text in item string.
							var itemStr = pageTextContent.items[iItem].str;
							itemStr = trim1(itemStr);
							if(itemStr.length === 0) {
								numItemsSkipped++;
								continue;
							}
							
							var matchPos = itemStr.search(regex);
							var itemStrStartIndex = 0;
							while(matchPos > -1) {
								$scope.searchResults.push({
									pageID: iPage,
									itemID: iItem - numItemsSkipped,
									matchPos: itemStrStartIndex + matchPos
								});

								itemStr = itemStr.substr(matchPos + text.length);
								itemStrStartIndex += matchPos + text.length;

								matchPos = itemStr.search(regex);
							}
						}
					}

					if($scope.searchResults.length > 0) {
						$scope.highlightSearchResult(0);
					}

					$scope.searchNumOccurences =  $scope.searchResults.length;
				};

				$scope.resizePDFPageToScale = function (page, scale) {
					var viewport = page.pdfPage.getViewport(scale);

					page.container.css("width", viewport.width + "px");
					page.container.css("height", viewport.height + "px");

					page.canvas.attr("width", viewport.width);
					page.canvas.attr("height", viewport.height);

					page.textLayer.css("width", viewport.width + "px");
					page.textLayer.css("height", viewport.height + "px");
				};

				$scope.calcPDFScale = function (pageList, desiredScale, containerWidth, containerHeight) {
					if(desiredScale === "fit_width") {
						// Find the widest page in the document and fit it to the container.
						var numPages = pageList.length;
						var maxWidth = pageList[0].pdfPage.getViewport(1.0).width;
						for(var iPage = 1;iPage < numPages;++iPage) {
							maxWidth = Math.max(maxWidth, $scope.pages[iPage].pdfPage.getViewport(1.0).width);
						}

						return containerWidth / maxWidth;
					} else if(desiredScale === "fit_page") {
						// Find the smaller dimension of the container and fit the 1st page to it.
						var page0Viewport = pageList[0].pdfPage.getViewport(1.0);

						if(containerHeight < containerWidth) {
							return containerHeight / page0Viewport.height;
						}

						return containerWidth / page0Viewport.width;
					}

					var scale = parseFloat(desiredScale);
					if(isNaN(scale)) {
						console.warn("PDF viewer: " + desiredScale + " isn't a valid scale value.");
						return 1.0;
					}
					
					return scale;
				};

				$scope.isPageInViewport = function (pageContainer) {
					var pageTop = pageContainer[0].offsetTop - $element[0].scrollTop;
					var pageBottom = pageTop + pageContainer[0].offsetHeight;
					return pageBottom >= 0 && pageTop <= $element[0].offsetHeight;
				};

				$scope.renderPDFPage = function (pageID, scale, callback) {
					var page = $scope.pages[pageID];
					var viewport = page.pdfPage.getViewport(scale);

					// We mark the page as rendered here because the renderTask 
					// might not have finished when we get in here again (e.g. 
					// due to scrolling).
					page.rendered = true;

					var renderTask = page.pdfPage.render({
						canvasContext: page.canvas[0].getContext('2d'),
						viewport: viewport
					});

					renderTask.then(function () {
						page.container.append(page.canvas);

						if(page.textContent) {
							var textLayerBuilder = new TextLayerBuilder({
								textLayerDiv: page.textLayer[0],
								pageIndex: pageID,
								viewport: viewport
							});

							textLayerBuilder.setTextContent(page.textContent);
							textLayerBuilder.renderLayer();

							page.container.append(page.textLayer);
						}

						if(callback !== null) {
							callback(pageID);
						}

						// Inform the client that the page has been rendered.
						if ($scope.progressCallback) {
							$scope.$apply(function () {
								$scope.progressCallback({ 
									operation: "render",
									state: "success",
									value: pageID + 1, 
									total: $scope.pages.length,
									message: ""
								});
							});
						}
					}, function (message) {
						page.rendered = false;

						// Inform the client that something went wrong while rendering the specified page!
						if ($scope.progressCallback) {
							$scope.$apply(function () {
								$scope.progressCallback({ 
									operation: "render",
									state: "failed",
									value: pageID + 1, 
									total: $scope.pages.length,
									message: "PDF.js: " + message
								});
							});
						}
					});
				};

				$scope.renderAllVisiblePages = function () {
					// Since pages are placed one after the other, we can stop the loop once
					// we find a page outside the viewport, iff we've already found one *inside* 
					// the viewport. It helps with large PDFs.
					var numPages = $scope.pages.length;
					var atLeastOnePageInViewport = false;
					var currentPageID = 0;
					for(var iPage = 0;iPage < numPages;++iPage) {
						var page = $scope.pages[iPage];
						
						var inViewport = $scope.isPageInViewport(page.container);
						if(inViewport) {
							var pageTop = page.container[0].offsetTop - $element[0].scrollTop;
							if(pageTop <= $element[0].offsetHeight / 2) {
								currentPageID = iPage;
							}

							atLeastOnePageInViewport = true;
							if(!page.rendered) {
								$scope.renderPDFPage(iPage, $scope.scale, null);
							}
						} else {
							if(atLeastOnePageInViewport) {
								break;
							}
						}
					}
					
					return currentPageID + 1;
				};

				$scope.onPDFScaleChanged = function (scale) {
					$scope.scale = scale;

					var numPages = $scope.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						var page = $scope.pages[iPage];

						// Clear the page...
						page.rendered = false;
						page.container.empty();
						page.textLayer.empty();

						// Resize to current scale...
						$scope.resizePDFPageToScale(page, scale);
					}

					$scope.highlightSearchResult($scope.searchResultId - 1);

					$scope.currentPage = $scope.renderAllVisiblePages();
				};

				$scope.onContainerSizeChanged = function (containerSize) {
					// Calculate fit_width and fit_page scales.
					$scope.fitWidthScale = $scope.calcPDFScale($scope.pages, "fit_width", containerSize.width, containerSize.height);
					$scope.fitPageScale = $scope.calcPDFScale($scope.pages, "fit_page", containerSize.width, containerSize.height);

					var scale = $scope.calcPDFScale($scope.pages, $scope.initialScale, containerSize.width, containerSize.height);
					$scope.onPDFScaleChanged(scale);
				};

				$scope.onPDFSrcChanged = function () {
					// TODO: Set the correct flag based on client's choice.
					PDFJS.disableTextLayer = false;

					// Since the PDF has changed we must clear the $element.
					$scope.pages = [];
					$scope.resetSearch();
					$element.empty();

					var getDocumentTask = PDFJS.getDocument($scope.src, null, $scope.getPDFPassword, $scope.downloadProgress);
					getDocumentTask.then(function (pdf) {
						$scope.pdf = pdf;

						// Get all the pages...
						$scope.getAllPDFPages(pdf, function (pageList) {
							$scope.pages = pageList;

							// Append all page containers to the $element...
							for(var iPage = 0;iPage < pageList.length; ++iPage) {
								$element.append($scope.pages[iPage].container);
							}

							var containerSize = $scope.getContainerSize();
							$scope.onContainerSizeChanged(containerSize);
						});
					}, function (message) {
						// Inform the client that something went wrong and we couldn't read the specified pdf.
						if ($scope.progressCallback) {
							$scope.$apply(function () {
								$scope.progressCallback({ 
									operation: "download",
									state: "failed",
									value: 0,
									total: 0,
									message: "PDF.js: " + message
								});
							});
						}
					});
				};

				$scope.onPDFFileChanged = function () {
					// TODO: Set the correct flag based on client's choice.
					PDFJS.disableTextLayer = false;

					// Since the PDF has changed we must clear the $element.
					$scope.pages = [];
					$scope.resetSearch();
					$element.empty();

					var reader = new FileReader();

					reader.onload = function(e) {
						var arrayBuffer = e.target.result;
						var uint8Array = new Uint8Array(arrayBuffer);

						var getDocumentTask = PDFJS.getDocument(uint8Array, null, $scope.getPDFPassword, $scope.downloadProgress);
						getDocumentTask.then(function (pdf) {
							$scope.pdf = pdf;

							// Get all the pages...
							$scope.getAllPDFPages(pdf, function (pageList) {
								$scope.pages = pageList;

								// Append all page containers to the $element...
								for(var iPage = 0;iPage < pageList.length; ++iPage) {
									$element.append($scope.pages[iPage].container);
								}

								var containerSize = $scope.getContainerSize();
								$scope.onContainerSizeChanged(containerSize);
							});
						}, function (message) {
							// Inform the client that something went wrong and we couldn't read the specified pdf.
							if ($scope.progressCallback) {
								$scope.$apply(function () {
									$scope.progressCallback({ 
										operation: "download",
										state: "failed",
										value: 0,
										total: 0,
										message: "PDF.js: " + message
									});
								});
							}
						});
					};

					reader.onprogress = function (e) {
						$scope.downloadProgress(e);
					};

					reader.onloadend = function (e) {
						var error = e.target.error;
						if(error !== null) {
							var message = "File API error: ";
							switch(e.code) {
								case error.ENCODING_ERR:
									message += "Encoding error.";
									break;
								case error.NOT_FOUND_ERR:
									message += "File not found.";
									break;
								case error.NOT_READABLE_ERR:
									message += "File could not be read.";
									break;
								case error.SECURITY_ERR:
									message += "Security issue with file.";
									break;
								default:
									message += "Unknown error.";
									break;
							}

							if ($scope.progressCallback) {
								$scope.$apply(function () {
									$scope.progressCallback({ 
										operation: "download",
										state: "failed",
										value: 0,
										total: 0,
										message: message
									});
								});
							}
						}
					};

					reader.readAsArrayBuffer($scope.file);
				};

				$element.bind("scroll", function (event) {
					var curPageID = $scope.renderAllVisiblePages();
					$scope.$apply(function () {
						$scope.currentPage = curPageID;
					});
				});

				// API...
				$scope.api = {
					getNextZoomInScale: function (scale) {
						// HACK: This should be possible using an analytic formula!
						var newScale = scale;
						var numZoomLevels = zoomLevelsLUT.length;
						for(var i = 0;i < numZoomLevels;++i) {
							if(zoomLevelsLUT[i] > scale) {
								newScale = zoomLevelsLUT[i];
								break;
							}
						}

						if(scale < $scope.fitWidthScale && newScale > $scope.fitWidthScale) {
							return {
								value: $scope.fitWidthScale,
								label: "Fit width"
							};
						} else if(scale < $scope.fitPageScale && newScale > $scope.fitPageScale) {
							return {
								value: $scope.fitPageScale,
								label: "Fit page"
							};
						}

						return {
							value: newScale,
							label: (newScale * 100.0).toFixed(0) + "%"
						};
					},
					getNextZoomOutScale: function (scale) {
						// HACK: This should be possible using an analytic formula!
						var newScale = scale;
						var numZoomLevels = zoomLevelsLUT.length;
						for(var i = numZoomLevels - 1; i >= 0;--i) {
							if(zoomLevelsLUT[i] < scale) {
								newScale = zoomLevelsLUT[i];
								break;
							}
						}

						if(scale > $scope.fitWidthScale && newScale < $scope.fitWidthScale) {
							return {
								value: $scope.fitWidthScale,
								label: "Fit width"
							};
						} else if(scale > $scope.fitPageScale && newScale < $scope.fitPageScale) {
							return {
								value: $scope.fitPageScale,
								label: "Fit page"
							};
						}

						return {
							value: newScale,
							label: (newScale * 100.0).toFixed(0) + "%"
						};
					},
					zoomTo: function (scale) {
						if(isNaN(parseFloat(scale))) {
							// scale isn't a valid floating point number. Let
							// calcPDFScale() handle it (e.g. fit_width or fit_page).
							var containerSize = $scope.getContainerSize();
							scale = $scope.calcPDFScale($scope.pages, scale, containerSize.width, containerSize.height);
						}

						$scope.onPDFScaleChanged(scale);
					},
					getZoomLevel: function () {
						return $scope.scale;
					},
					goToPage: function (pageIndex) {
						if($scope.pdf === null || pageIndex < 1 || pageIndex > $scope.pdf.numPages) {
							return;
						}

						$scope.pages[pageIndex - 1].container[0].scrollIntoView();
					},
					getNumPages: function () {
						if($scope.pdf === null) {
							return 0;
						}

						return $scope.pdf.numPages;
					},
					findNext: function () {
						var nextHighlightID = $scope.searchResultId + 1;
						if(nextHighlightID > $scope.searchResults.length) {
							nextHighlightID = 1;
						}
						
						$scope.highlightSearchResult(nextHighlightID - 1);
					},
					findPrev: function () {
						var prevHighlightID = $scope.searchResultId - 1;
						if(prevHighlightID <= 0) {
							prevHighlightID = $scope.searchResults.length;
						}
						
						$scope.highlightSearchResult(prevHighlightID - 1);
					}
				};
			}],
			link: function (scope, element, attrs) {
				attrs.$observe('src', function (src) {
					if (src !== undefined && src !== null && src !== '') {
						scope.onPDFSrcChanged();
					}
				});

				scope.$watch("file", function (file) {
					if(scope.file !== null) {
						scope.onPDFFileChanged();
					}
				});
				
				attrs.$observe("searchTerm", function (searchTerm) {
					if (searchTerm !== undefined && searchTerm !== null && searchTerm !== '') {
						scope.searchPDF(searchTerm);
					} else {
						scope.resetSearch();
					}
				});
			}
		};
	}]);
})(angular, PDFJS, document);
