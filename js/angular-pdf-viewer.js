/*
 * angular-pdf-viewer v1.2.1
 * https://github.com/jdryg/angular-pdf-viewer
 */
(function (angular, PDFJS, document) {
	"use strict";

	/*
	 * PDF.js link service implementation for the annotation layer.
	 * 
	 * See IPDFLinkService in PDF.js web/interfaces.js for details.
	 * 
	 * Only the functions used by the annotation layer builder are implemented.
	 * NOTE: This implementation is still unfinished (some cases aren't handled
	 * and produce a warning in the console).
	 */
	function PDFLinkService(viewer) {
		this.pagesRefMap = viewer.pagesRefMap;
		this.api = viewer.api;
	}

	PDFLinkService.prototype = {
		getAnchorUrl: function (hash) {
			return hash;
		},
		navigateTo: function (dest) {
			if (typeof dest === 'string') {
				console.warn("PDFLinkService.navigateTo(string) not implemented yet.");
				return;
			}

			if (dest instanceof Array) {
				var destRef = dest[0];
				var pageNumber = destRef instanceof Object ? this.pagesRefMap[destRef.num + ' ' + destRef.gen + ' R'] : (destRef + 1);

				if (pageNumber) {
					this.api.goToPage(pageNumber);
					return;
				}
			}

			console.warn("PDFLinkService.navigateTo(" + (typeof dest) + ") not implemented yet.");
		},
		getDestinationHash: function (dest) {
			if (typeof dest === 'string') {
				return this.getAnchorUrl("#" + escape(dest));
			}

			if (typeof dest === Array) {
				return this.getAnchorUrl("");
			}

			return "";
		},
		executeNamedAction: function (action) {
			// List of actions taken from PDF.js viewer.js
			switch (action) {
				case 'NextPage':
					this.api.goToNextPage();
					break;
				case 'PrevPage':
					this.api.goToPrevPage();
					break;
				case 'LastPage':
					this.api.goToPage(this.api.getNumPages());
					break;
				case 'FirstPage':
					this.api.goToPage(1);
					break;
				case 'GoToPage':
					// Ignore...
					break;
				case 'Find':
					// Ignore...
					break;
				case 'GoBack':
					console.warn("PDFLinkService: GoBack action not implemented yet.");
					break;
				case 'GoForward':
					console.warn("PDFLinkService: GoForward action not implemented yet.");
					break;
				default:
					break;
			}
		}
	};

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
				var _ctrl = this;

				_ctrl.pages = [];
				_ctrl.searchResults = [];
				
				$scope.pdf = null;
				$scope.scale = 1.0;
				$scope.fitWidthScale = 1.0;
				$scope.fitPageScale = 1.0;
				$scope.searching = false;
				$scope.lastScrollY = 0;
				$scope.pagesRefMap = {};
				$scope.pdfLinkService = null;

				/**
				 * Returns the inner size of the element taking into account the vertical scrollbar that will
				 * appear if the element gets really tall. 
				 * 
				 * @argument {element} element The element we are calculating its inner size
				 * @argument {integer} margin Margin around the element (subtracted from the element's size)
				 */ 
				_ctrl.getElementInnerSize = function (element, margin) {
					var tallTempElement = angular.element("<div></div>");
					tallTempElement.css("height", "10000px");
					element.append(tallTempElement);

					var w = tallTempElement[0].offsetWidth;

					tallTempElement.remove();

					var h = element[0].offsetHeight;
					if(h === 0) {
						// TODO: Should we get the parent height?
						h = 2 * margin;
					}

					w -= 2 * margin;
					h -= 2 * margin;

					return {
						width: w,
						height: h
					};
				};

				_ctrl.PDFPage_create = function (pdfPage, textContent) {
					var pageContainer = angular.element("<div></div>");
					pageContainer.addClass("page");
					pageContainer.attr("id", "page_" + pdfPage.pageIndex);

					var canvasElement = angular.element("<canvas></canvas>");
					var textLayerElement = angular.element("<div></div>");
					textLayerElement.addClass("text-layer");

					return {
						id: pdfPage.pageIndex + 1,
						pdfPage: pdfPage,
						textContent: textContent,
						container: pageContainer,
						canvas: canvasElement,
						textLayer: textLayerElement,
						rendered: false,
						renderTask: null
					};
				};
				
				_ctrl.PDFPage_clear = function (page) {
					if(page.renderTask !== null) {
						page.renderTask.cancel();
					}

					page.rendered = false;
					page.renderTask = null;
					page.textLayer.empty();
					page.container.empty();
				};

				_ctrl.PDFPage_resizeToScale = function (page, scale) {
					var viewport = page.pdfPage.getViewport(scale);

					page.container.css("width", viewport.width + "px");
					page.container.css("height", viewport.height + "px");

					page.canvas.attr("width", viewport.width);
					page.canvas.attr("height", viewport.height);

					page.textLayer.css("width", viewport.width + "px");
					page.textLayer.css("height", viewport.height + "px");
				};

				_ctrl.PDFPage_isVisible = function (page) {
					var pageContainer = page.container[0];
					var parentContainer = page.container.parent()[0];

					var pageTop = pageContainer.offsetTop - parentContainer.scrollTop;
					var pageBottom = pageTop + pageContainer.offsetHeight;

					return pageBottom >= 0 && pageTop <= parentContainer.offsetHeight;
				};

				_ctrl.PDFPage_highlightItem = function (page, itemID, matchPos, text) {
					var textLayer = page.textLayer;
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

					// Scroll to item...
					var parentContainer = page.container.parent()[0];

					var curScrollTop = parentContainer.scrollTop;
					var containerHeight = parentContainer.offsetHeight;

					highlight_span.scrollIntoView();

					var newScrollTop = parentContainer.scrollTop;

					var scrolledDown = newScrollTop > curScrollTop;
					var newScrollPosInOldViewport = curScrollTop + containerHeight > newScrollTop;
					var scrolledToEnd = newScrollTop >= parentContainer.scrollHeight - containerHeight;

					if(scrolledDown && newScrollPosInOldViewport && !scrolledToEnd) {
						parentContainer.scrollTop = curScrollTop;
					} else {
						parentContainer.scrollTop -= containerHeight / 4;
					}
				};
				
				_ctrl.PDFViewer_getAllPages = function (pdf, hasTextLayer, callback) {
					var self = this,
					    pageList = [],
					    pagesRefMap = {},
					    numPages = pdf.numPages,
					    remainingPages = numPages;

					if(hasTextLayer) {
						for(var iPage = 0;iPage < numPages;++iPage) {
							pageList.push({});

							var getPageTask = pdf.getPage(iPage + 1);
							getPageTask.then(function (page) {
								// Page reference map. Required by the annotation layer.
								var refStr = page.ref.num + ' ' + page.ref.gen + ' R';
								pagesRefMap[refStr] = page.pageIndex + 1;

								var textContentTask = page.getTextContent();
								textContentTask.then(function (textContent) {
									pageList[page.pageIndex] = self.PDFPage_create(page, textContent);

									--remainingPages;
									if(remainingPages === 0) {
										callback(pageList, pagesRefMap);
									}
								});
							});
						}
					} else {
						for(var iPage = 0;iPage < numPages;++iPage) {
							pageList.push({});

							var getPageTask = pdf.getPage(iPage + 1);
							getPageTask.then(function (page) {
								pageList[page.pageIndex] = self.PDFPage_create(page, null);

								--remainingPages;
								if(remainingPages === 0) {
									callback(pageList, pagesRefMap);
								}
							});
						}
					}
				};

				_ctrl.PDFViewer_removeDistantPages = function (curPageID, distance) {
					var numPages = this.pages.length;

					var firstActivePageID = Math.max(curPageID - distance, 0);
					var lastActivePageID = Math.min(curPageID + distance, numPages - 1);

					for(var iPage = 0;iPage < firstActivePageID;++iPage) {
						this.PDFPage_clear(this.pages[iPage]);
					}

					for(var iPage = lastActivePageID + 1;iPage < numPages;++iPage) {
						this.PDFPage_clear(this.pages[iPage]);
					}
				};

				_ctrl.PDFViewer_calcScale = function (desiredScale, containerSize) {
					if(desiredScale === "fit_width") {
						// Find the widest page in the document and fit it to the container.
						var numPages = this.pages.length;
						var maxWidth = this.pages[0].pdfPage.getViewport(1.0).width;
						for(var iPage = 1;iPage < numPages;++iPage) {
							maxWidth = Math.max(maxWidth, this.pages[iPage].pdfPage.getViewport(1.0).width);
						}

						return containerSize.width / maxWidth;
					} else if(desiredScale === "fit_page") {
						// Find the smaller dimension of the container and fit the 1st page to it.
						var page0Viewport = this.pages[0].pdfPage.getViewport(1.0);

						if(containerSize.height < containerSize.width) {
							return containerSize.height / page0Viewport.height;
						}

						return containerSize.width / page0Viewport.width;
					}

					var scale = parseFloat(desiredScale);
					if(isNaN(scale)) {
						console.log("PDF viewer: " + desiredScale + " isn't a valid scale value.");
						return 1.0;
					}

					return scale;
				};

				// TODO: resultID goes from 1 to searchResults.length. 
				_ctrl.PDFViewer_clearSearchHighlight = function (resultID) {
					if(resultID <= 0 || resultID > this.searchResults.length) {
						return;
					}

					var result = this.searchResults[resultID - 1];
					if(result === null) {
						return;
					}

					var textLayer = this.pages[result.pageID].textLayer;
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

				$scope.shouldRenderTextLayer = function () {
					if(this.renderTextLayer === "" || this.renderTextLayer === undefined || this.renderTextLayer === null || this.renderTextLayer.toLowerCase() === "false") {
						return false;
					}

					return true;
				};

				$scope.highlightSearchResult = function (resultID) {
					_ctrl.PDFViewer_clearSearchHighlight(this.searchResultId);

					if(resultID < 0 || resultID >= _ctrl.searchResults.length) {
						return;
					}

					var result = _ctrl.searchResults[resultID];
					if(result.pageID < 0 || result.pageID >= _ctrl.pages.length) {
						return;
					}

					var self = this;
					this.searching = true;
					this.renderPDFPage(result.pageID, this.scale, function () {
						_ctrl.PDFPage_highlightItem(_ctrl.pages[result.pageID], result.itemID, result.matchPos, self.searchTerm);
						self.searchResultId = resultID + 1;
						self.searching = false;
					});
				};

				$scope.resetSearch = function () {
					_ctrl.PDFViewer_clearSearchHighlight(this.searchResultId);
					_ctrl.searchResults = [];
					this.searchResultId = 0;
					this.searchNumOccurences = 0;
					this.searchTerm = "";
				};

				function trim1 (str) {
					return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
				}

				$scope.searchPDF = function (text) {
					if(!this.shouldRenderTextLayer()) {
						return 0;
					}

					this.resetSearch();

					this.searchTerm = text;

					var regex = new RegExp(text, "i");

					var numPages = _ctrl.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						var pageTextContent = _ctrl.pages[iPage].textContent;
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
								_ctrl.searchResults.push({
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

					if(_ctrl.searchResults.length > 0) {
						this.highlightSearchResult(0);
					}

					this.searchNumOccurences =  _ctrl.searchResults.length;
				};

				$scope.renderPDFPage = function (pageID, scale, callback) {
					var self = this;
					var page = _ctrl.pages[pageID];

					if(page.rendered) {
						if(page.renderTask === null) {
							if(callback) {
								callback(pageID);
							}
						} else {
							if(callback) {
								page.renderTask.then(function () {
									callback(pageID);
								});
							}
						}

						return;
					}

					var viewport = page.pdfPage.getViewport(scale);

					page.rendered = true;

					page.renderTask = page.pdfPage.render({
						canvasContext: page.canvas[0].getContext('2d'),
						viewport: viewport
					});

					page.renderTask.then(function () {
						page.rendered = true;
						page.renderTask = null;

						page.container.append(page.canvas);

						if(page.textContent) {
							// Render the text layer...
							var textLayerBuilder = new TextLayerBuilder({
								textLayerDiv: page.textLayer[0],
								pageIndex: pageID,
								viewport: viewport
							});

							textLayerBuilder.setTextContent(page.textContent);
							textLayerBuilder.renderLayer();
							page.container.append(page.textLayer);

							// Render the annotation layer...
							// NOTE: Annotation div is inserted into the page div iff
							// there are annotations in the current page. This is 
							// handled by the AnnotationLayerBuilder.
							var annotationLayerBuilder = new AnnotationsLayerBuilder({
								pageDiv: page.container[0],
								pdfPage: page.pdfPage,
								linkService: self.pdfLinkService
							});

							annotationLayerBuilder.setupAnnotations(viewport);
						}

						if(callback !== null) {
							callback(pageID);
						}

						// Inform the client that the page has been rendered.
						if (self.progressCallback) {
							self.$apply(function () {
								self.progressCallback({ 
									operation: "render",
									state: "success",
									value: pageID + 1, 
									total: _ctrl.pages.length,
									message: ""
								});
							});
						}
					}, function (message) {
						page.rendered = false;
						page.renderTask = null;

						if(message === "cancelled") {
							console.log("page render task cancelled");
							return;
						}

						// Inform the client that something went wrong while rendering the specified page!
						if (self.progressCallback) {
							self.$apply(function () {
								self.progressCallback({ 
									operation: "render",
									state: "failed",
									value: pageID + 1, 
									total: _ctrl.pages.length,
									message: "PDF.js: " + message
								});
							});
						}
					});
				};

				$scope.renderAllVisiblePages = function (scrollDir) {
					// Since pages are placed one after the other, we can stop the loop once
					// we find a page outside the viewport, iff we've already found one *inside* 
					// the viewport. It helps with large PDFs.
					var numPages = _ctrl.pages.length;
					var atLeastOnePageInViewport = false;
					var currentPageID = 0;
					for(var iPage = 0;iPage < numPages;++iPage) {
						var page = _ctrl.pages[iPage];

						var inViewport = _ctrl.PDFPage_isVisible(page);
						if(inViewport) {
							var pageTop = page.container[0].offsetTop - $element[0].scrollTop;
							if(pageTop <= $element[0].offsetHeight / 2) {
								currentPageID = iPage;
							}

							atLeastOnePageInViewport = true;
							this.renderPDFPage(iPage, this.scale, null);
						} else {
							if(atLeastOnePageInViewport) {
								break;
							}
						}
					}

					if(scrollDir !== 0) {
						var nextPageID = currentPageID + scrollDir;
						if(nextPageID >= 0 && nextPageID < numPages) {
							this.renderPDFPage(nextPageID, this.scale, null);
						}
					}

					return currentPageID + 1;
				};

				$scope.onPDFScaleChanged = function (scale) {
					this.scale = scale;

					var numPages = _ctrl.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						// Clear the page's contents...
						_ctrl.PDFPage_clear(_ctrl.pages[iPage]);

						// Resize to current scale...
						_ctrl.PDFPage_resizeToScale(_ctrl.pages[iPage], scale);
					}

					this.highlightSearchResult(this.searchResultId - 1);

					this.currentPage = this.renderAllVisiblePages(0);
				};

				$scope.onContainerSizeChanged = function (containerSize) {
					// Calculate fit_width and fit_page scales.
					this.fitWidthScale = _ctrl.PDFViewer_calcScale("fit_width", containerSize);
					this.fitPageScale = _ctrl.PDFViewer_calcScale("fit_page", containerSize);

					var scale = _ctrl.PDFViewer_calcScale(this.initialScale, containerSize);
					this.onPDFScaleChanged(scale);
				};

				$scope.onPDFSrcChanged = function () {
					// TODO: Set the correct flag based on client's choice.
					PDFJS.disableTextLayer = false;

					// Since the PDF has changed we must clear the $element.
					this.resetSearch();
					_ctrl.pages = [];
					this.lastScrollY = 0;
					this.pdfLinkService = null;
					this.pagesRefMap = {};
					$element.empty();

					var self = this;
					var getDocumentTask = PDFJS.getDocument(this.src, null, this.getPDFPassword, this.downloadProgress);
					getDocumentTask.then(function (pdf) {
						self.pdf = pdf;

						// Get all the pages...
						_ctrl.PDFViewer_getAllPages(pdf, self.shouldRenderTextLayer(), function (pageList, pagesRefMap) {
							_ctrl.pages = pageList;
							self.pagesRefMap = pagesRefMap;
							self.pdfLinkService = new PDFLinkService(self);

							// Append all page containers to the $element...
							for(var iPage = 0;iPage < pageList.length; ++iPage) {
								$element.append(_ctrl.pages[iPage].container);
							}

							var containerSize = _ctrl.getElementInnerSize($element, pageMargin);
							self.onContainerSizeChanged(containerSize);
						});
					}, function (message) {
						// Inform the client that something went wrong and we couldn't read the specified pdf.
						if (self.progressCallback) {
							self.$apply(function () {
								self.progressCallback({ 
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
					this.resetSearch();
					_ctrl.pages = [];
					this.lastScrollY = 0;
					this.pdfLinkService = null;
					this.pagesRefMap = {};
					$element.empty();

					var self = this;
					var reader = new FileReader();
					reader.onload = function(e) {
						var arrayBuffer = e.target.result;
						var uint8Array = new Uint8Array(arrayBuffer);

						var getDocumentTask = PDFJS.getDocument(uint8Array, null, self.getPDFPassword, self.downloadProgress);
						getDocumentTask.then(function (pdf) {
							self.pdf = pdf;

							// Get all the pages...
							_ctrl.PDFViewer_getAllPages(pdf, self.shouldRenderTextLayer(), function (pageList, pagesRefMap) {
								_ctrl.pages = pageList;
								self.pagesRefMap = pagesRefMap;
								self.pdfLinkService = new PDFLinkService(self);

								// Append all page containers to the $element...
								for(var iPage = 0;iPage < pageList.length; ++iPage) {
									$element.append(_ctrl.pages[iPage].container);
								}

								var containerSize = _ctrl.getElementInnerSize($element, pageMargin);
								self.onContainerSizeChanged(containerSize);
							});
						}, function (message) {
							// Inform the client that something went wrong and we couldn't read the specified pdf.
							if (self.progressCallback) {
								self.$apply(function () {
									self.progressCallback({ 
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
						self.downloadProgress(e);
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

							if (self.progressCallback) {
								self.$apply(function () {
									self.progressCallback({ 
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

					reader.readAsArrayBuffer(this.file);
				};

				$element.bind("scroll", function (event) {
					var scrollDir = $element[0].scrollTop - $scope.lastScrollY;
					$scope.lastScrollY = $element[0].scrollTop;

					var curPageID = $scope.renderAllVisiblePages(scrollDir > 0 ? 1 : (scrollDir < 0 ? -1 : 0));
					_ctrl.PDFViewer_removeDistantPages(curPageID, 5);
					$scope.$apply(function () {
						$scope.currentPage = curPageID;
					});
				});

				// API...
				$scope.api = (function (viewer) {
					return {
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

							if(scale < viewer.fitWidthScale && newScale > viewer.fitWidthScale) {
								return {
									value: viewer.fitWidthScale,
									label: "Fit width"
								};
							} else if(scale < viewer.fitPageScale && newScale > viewer.fitPageScale) {
								return {
									value: viewer.fitPageScale,
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

							if(scale > viewer.fitWidthScale && newScale < viewer.fitWidthScale) {
								return {
									value: viewer.fitWidthScale,
									label: "Fit width"
								};
							} else if(scale > viewer.fitPageScale && newScale < viewer.fitPageScale) {
								return {
									value: viewer.fitPageScale,
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
								// PDFViewer_calcScale() handle it (e.g. fit_width or fit_page).
								var containerSize = _ctrl.getElementInnerSize($element, pageMargin);
								scale = _ctrl.PDFViewer_calcScale(scale, containerSize);
							}

							viewer.onPDFScaleChanged(scale);
						},
						getZoomLevel: function () {
							return viewer.scale;
						},
						goToPage: function (pageIndex) {
							if(viewer.pdf === null || pageIndex < 1 || pageIndex > viewer.pdf.numPages) {
								return;
							}

							_ctrl.pages[pageIndex - 1].container[0].scrollIntoView();
						},
						goToNextPage: function () {
							if(viewer.pdf === null) {
								return;
							}

							this.goToPage(viewer.currentPage + 1);
						},
						goToPrevPage: function () {
							if(viewer.pdf === null) {
								return;
							}

							this.goToPage(viewer.currentPage - 1);
						},
						getNumPages: function () {
							if(viewer.pdf === null) {
								return 0;
							}

							return viewer.pdf.numPages;
						},
						findNext: function () {
							if(viewer.searching) {
								return;
							}

							var nextHighlightID = viewer.searchResultId + 1;
							if(nextHighlightID > _ctrl.searchResults.length) {
								nextHighlightID = 1;
							}

							viewer.highlightSearchResult(nextHighlightID - 1);
						},
						findPrev: function () {
							if(viewer.searching) {
								return;
							}

							var prevHighlightID = viewer.searchResultId - 1;
							if(prevHighlightID <= 0) {
								prevHighlightID = _ctrl.searchResults.length;
							}

							viewer.highlightSearchResult(prevHighlightID - 1);
						}
					};
				})($scope);
			}],
			link: function (scope, element, attrs) {
				attrs.$observe('src', function (src) {
					if (src !== undefined && src !== null && src !== '') {
						scope.onPDFSrcChanged();
					}
				});

				scope.$watch("file", function (file) {
					if(scope.file !== undefined && scope.file !== null) {
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
