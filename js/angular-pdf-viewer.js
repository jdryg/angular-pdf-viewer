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
	function PDFLinkService(pagesRefMap, api) {
		this.pagesRefMap = pagesRefMap;
		this.api = api;
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

				_ctrl.pdf = null;
				_ctrl.pages = [];
				_ctrl.scale = 1.0;
				_ctrl.pdfLinkService = null;
				_ctrl.pagesRefMap = {};
				_ctrl.searchResults = [];
				_ctrl.searchTerm = "";
				_ctrl.searchHighlightResultID = -1;
				_ctrl.fitWidthScale = 1.0;
				_ctrl.fitPageScale = 1.0;
				_ctrl.searching = false;
				_ctrl.lastScrollY = 0;
				_ctrl.PDFViewer_onSearch = null;
				_ctrl.PDFViewer_onPageRendered = null;
				_ctrl.PDFViewer_onDataDownloaded = null;
				_ctrl.PDFViewer_onCurrentPageChanged = null;
				_ctrl.PDFViewer_passwordCallback = null;

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

				_ctrl.PDFPage_render = function (page, scale) {
					var self = this;

					return new Promise(function (resolve, reject) {
						if(page.rendered) {
							if(page.renderTask === null) {
								resolve({
									pageID: page.id,
									status: 0 // TODO: Make this a constant. Means "Page already exists"
								});
							} else {
								page.renderTask.then(function () {
									resolve({
										pageID: page.id,
										status: 2 // TODO: Make thid a constant. Means "Page already scheduled for rendering"
									});
								});
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
									pageIndex: page.id,
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

							self.PDFViewer_onPageRendered("success", page.id, self.pdf.numPages, "");

							resolve({
								pageID: page.id,
								status: 1 // TODO: Make this a constant. Means "Page rendered"
							});
						}, function (message) {
							page.rendered = false;
							page.renderTask = null;

							if(message === "cancelled") {
								resolve({
									pageID: page.id,
									status: 3 // TODO: Make this a constant. Means "Page rendering cancelled"
								});
							} else {			
								reject({
									pageID: page.id,
									message: "PDF.js: " + message
								});
							}
						});
					});
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

				_ctrl.PDFViewer_setScale = function (scale) {
					this.scale = scale;

					var numPages = this.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						// Clear the page's contents...
						this.PDFPage_clear(this.pages[iPage]);

						// Resize to current scale...
						this.PDFPage_resizeToScale(this.pages[iPage], scale);
					}

					this.PDFViewer_highlightSearchResult(this.searchHighlightResultID);
					this.PDFViewer_renderAllVisiblePages(0);
				};
				
				_ctrl.PDFViewer_setContainerSize = function (initialScale, containerSize) {
					_ctrl.fitWidthScale = _ctrl.PDFViewer_calcScale("fit_width", containerSize);
					_ctrl.fitPageScale = _ctrl.PDFViewer_calcScale("fit_page", containerSize);

					_ctrl.PDFViewer_setScale(_ctrl.PDFViewer_calcScale(initialScale, containerSize));
				};

				_ctrl.PDFViewer_renderAllVisiblePages = function (scrollDir) {
					var numPages = this.pages.length;
					var currentPageID = 0;

					var atLeastOnePageInViewport = false;
					for(var iPage = 0;iPage < numPages;++iPage) {
						var page = this.pages[iPage];

						var inViewport = this.PDFPage_isVisible(page);
						if(inViewport) {
							var parentContainer = page.container.parent()[0];
							var pageTop = page.container[0].offsetTop - parentContainer.scrollTop;
							if(pageTop <= parentContainer.offsetHeight / 2) {
								currentPageID = iPage;
							}

							atLeastOnePageInViewport = true;
							this.PDFPage_render(page, _ctrl.scale);
						} else {
							if(atLeastOnePageInViewport) {
								break;
							}
						}
					}

					if(scrollDir !== 0) {
						var nextPageID = currentPageID + scrollDir;
						if(nextPageID >= 0 && nextPageID < numPages) {
							this.PDFPage_render(this.pages[nextPageID], _ctrl.scale);
						}
					}

					this.PDFViewer_removeDistantPages(currentPageID, 5);

					this.PDFViewer_onCurrentPageChanged(currentPageID + 1);
				};

				_ctrl.PDFViewer_clearLastSearchHighlight = function () {
					var resultID = this.searchHighlightResultID;
					if(resultID < 0 || resultID >= this.searchResults.length) {
						return;
					}

					this.searchHighlightResultID = -1;

					var result = this.searchResults[resultID];
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

				_ctrl.PDFViewer_resetSearch = function () {
					this.PDFViewer_clearLastSearchHighlight();
					this.searchResults = [];
					this.searchTerm = "";
					this.searchHighlightResultID = -1;
					
					this.PDFViewer_onSearch("reset", 0, 0, "");
				};

				function trim1 (str) {
					return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
				}

				_ctrl.PDFViewer_search = function (text) {
					this.PDFViewer_resetSearch();
					this.searchTerm = text;

					var regex = new RegExp(text, "i");

					var numPages = this.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						var pageTextContent = this.pages[iPage].textContent;
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
								this.searchResults.push({
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

					var numOccurences = this.searchResults.length;
					if(numOccurences > 0) {
						this.PDFViewer_highlightSearchResult(0);
					} else {
						this.PDFViewer_onSearch("done", 0, 0, text);
					}
				};

				_ctrl.PDFViewer_highlightSearchResult = function (resultID) {
					var self = this;

					this.PDFViewer_clearLastSearchHighlight();

					if(resultID < 0 || resultID >= this.searchResults.length) {
						if(resultID === -1 && this.searchResults.length === 0) {
							this.PDFViewer_onSearch("done", -1, 0, this.searchTerm);
						} else {
							this.PDFViewer_onSearch("failed", resultID, this.searchResults.length, "Invalid search result index");
						}

						return;
					}

					var result = this.searchResults[resultID];
					if(result.pageID < 0 || result.pageID >= this.pages.length) {
						this.PDFViewer_onSearch("failed", resultID, this.searchResults.length, "Invalid page index in search result");
						return;
					}

					var self = this;
					this.PDFPage_render(this.pages[result.pageID], this.scale).then(function (data) {
						if(data.status === 3) {
							return; // Page cancelled so no point in highlighting anything...
						}

						self.PDFPage_highlightItem(self.pages[result.pageID], result.itemID, result.matchPos, self.searchTerm);
						self.searchHighlightResultID = resultID;

						self.PDFViewer_onSearch("done", self.searchHighlightResultID, self.searchResults.length, self.searchTerm);
					}, function (data) {
						self.PDFViewer_onSearch("failed", resultID, self.searchResults.length, "Failed to render page " + data.pageID);
					});
				};

				_ctrl.PDFViewer_downloadProgress = function (progressData) {
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

					this.PDFViewer_onDataDownloaded("loading", progressData.loaded, total, "");
				};
				
				_ctrl.PDFViewer_setUrl = function (url, element, initialScale, renderTextLayer, api) {
					this.PDFViewer_resetSearch();
					this.pages = [];
					this.lastScrollY = 0;
					this.pdfLinkService = null;
					this.pagesRefMap = {};

					var self = this;
					var getDocumentTask = PDFJS.getDocument(url, null, angular.bind(this, this.PDFViewer_passwordCallback), angular.bind(this, this.PDFViewer_downloadProgress));
					getDocumentTask.then(function (pdf) {
						self.pdf = pdf;

						// Get all the pages...
						self.PDFViewer_getAllPages(pdf, renderTextLayer, function (pageList, pagesRefMap) {
							self.pages = pageList;
							self.pagesRefMap = pagesRefMap;
							self.pdfLinkService = new PDFLinkService(pagesRefMap, api);

							// Append all page containers to the $element...
							for(var iPage = 0;iPage < pageList.length; ++iPage) {
								element.append(pageList[iPage].container);
							}

							var containerSize = self.getElementInnerSize(element, pageMargin);
							self.PDFViewer_setContainerSize(initialScale, containerSize);
						});
					}, function (message) {
						self.PDFViewer_onDataDownloaded("failed", 0, 0, "PDF.js: " + message);
					});
				};
				
				_ctrl.PDFViewer_setFile = function (file, element, initialScale, renderTextLayer, api) {
					this.PDFViewer_resetSearch();
					this.pages = [];
					this.lastScrollY = 0;
					this.pdfLinkService = null;
					this.pagesRefMap = {};

					var self = this;
					var reader = new FileReader();
					reader.onload = function(e) {
						var arrayBuffer = e.target.result;
						var uint8Array = new Uint8Array(arrayBuffer);

						var getDocumentTask = PDFJS.getDocument(uint8Array, null, angular.bind(self, self.PDFViewer_passwordCallback), angular.bind(self, self.PDFViewer_downloadProgress));
						getDocumentTask.then(function (pdf) {
							self.pdf = pdf;

							// Get all the pages...
							self.PDFViewer_getAllPages(pdf, renderTextLayer, function (pageList, pagesRefMap) {
								self.pages = pageList;
								self.pagesRefMap = pagesRefMap;
								self.pdfLinkService = new PDFLinkService(pagesRefMap, api);

								// Append all page containers to the $element...
								for(var iPage = 0;iPage < pageList.length; ++iPage) {
									element.append(pageList[iPage].container);
								}

								var containerSize = self.getElementInnerSize(element, pageMargin);
								self.PDFViewer_setContainerSize(initialScale, containerSize);
							});
						}, function (message) {
							self.PDFViewer_onDataDownloaded("failed", 0, 0, "PDF.js: " + message);
						});
					};

					reader.onprogress = function (e) {
						self.PDFViewer_downloadProgress(e);
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

							self.PDFViewer_onDataDownloaded("failed", 0, 0, message);
						}
					};

					reader.readAsArrayBuffer(file);
				};

				$scope.onPageRendered = function (status, pageID, numPages, message) {
					this.onProgress("render", status, pageID, numPages, message);
				};

				$scope.onDataDownloaded = function (status, loaded, total, message) {
					this.onProgress("download", status, loaded, total, message);
				};

				$scope.onSearch = function (status, curResultID, totalResults, message) {
					if(status === "searching") {
						this.searching = true;
					} else if(status === "failed") {
						this.searching = false;
						console.log("Searching failed. " + message);
					} else if(status === "done") {
						this.searching = false;
						this.searchTerm = message;
						this.searchResultId = curResultID + 1;
						this.searchNumOccurences = totalResults;
					} else if(status === "reset") {
						this.searching = false;
						this.searchTerm = "";
						this.searchResultId = 0;
						this.searchNumOccurences = 0;
					}
				};
				
				$scope.onCurrentPageChanged = function (pageID) {
					this.currentPage = pageID;
				};

				$scope.getPDFPassword = function (passwordFunc, reason) {
					if(this.passwordCallback) {
						var self = this;
						this.$apply(function () {
							var password = self.passwordCallback({reason: reason});

							if(password !== "" && password !== undefined && password !== null) {
								passwordFunc(password);
							} else {
								this.onPageRendered("failed", 1, 0, "A password is required to read this document.");
							}
						});
					} else {
						this.onPageRendered("failed", 1, 0, "A password is required to read this document.");
					}
				};

				$scope.onProgress = function (operation, state, value, total, message) {
					if (this.progressCallback) {
						var self = this;
						this.$apply(function () {
							self.progressCallback({ 
								operation: operation,
								state: state, 
								value: value, 
								total: total,
								message: message
							});
						});
					}
				};

				_ctrl.PDFViewer_onSearch = angular.bind($scope, $scope.onSearch);
				_ctrl.PDFViewer_onPageRendered = angular.bind($scope, $scope.onPageRendered);
				_ctrl.PDFViewer_onDataDownloaded = angular.bind($scope, $scope.onDataDownloaded);
				_ctrl.PDFViewer_onCurrentPageChanged = angular.bind($scope, $scope.onCurrentPageChanged);
				_ctrl.PDFViewer_passwordCallback = angular.bind($scope, $scope.getPDFPassword);

				$scope.shouldRenderTextLayer = function () {
					if(this.renderTextLayer === "" || this.renderTextLayer === undefined || this.renderTextLayer === null || this.renderTextLayer.toLowerCase() === "false") {
						return false;
					}

					return true;
				};

				$scope.resetSearch = function () {
					_ctrl.PDFViewer_resetSearch();
				};

				$scope.searchPDF = function (text) {
					if(!this.shouldRenderTextLayer()) {
						return;
					}

					_ctrl.PDFViewer_search(text);
				};

				$scope.onPDFSrcChanged = function () {
					$element.empty();
					_ctrl.PDFViewer_setUrl(this.src, $element, this.initialScale, this.shouldRenderTextLayer(), this.api);
				};

				$scope.onPDFFileChanged = function () {
					$element.empty();
					_ctrl.PDFViewer_setFile(this.file, $element, this.initialScale, this.shouldRenderTextLayer(), this.api);
				};

				$element.bind("scroll", function (event) {
					$scope.$apply(function () {
						var scrollDir = $element[0].scrollTop - _ctrl.lastScrollY;
						_ctrl.lastScrollY = $element[0].scrollTop;
						_ctrl.PDFViewer_renderAllVisiblePages(scrollDir > 0 ? 1 : (scrollDir < 0 ? -1 : 0));
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

							if(scale < _ctrl.fitWidthScale && newScale > _ctrl.fitWidthScale) {
								return {
									value: _ctrl.fitWidthScale,
									label: "Fit width"
								};
							} else if(scale < _ctrl.fitPageScale && newScale > _ctrl.fitPageScale) {
								return {
									value: _ctrl.fitPageScale,
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

							if(scale > _ctrl.fitWidthScale && newScale < _ctrl.fitWidthScale) {
								return {
									value: _ctrl.fitWidthScale,
									label: "Fit width"
								};
							} else if(scale > _ctrl.fitPageScale && newScale < _ctrl.fitPageScale) {
								return {
									value: _ctrl.fitPageScale,
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

							_ctrl.PDFViewer_setScale(scale);
						},
						getZoomLevel: function () {
							return _ctrl.scale;
						},
						goToPage: function (pageIndex) {
							if(_ctrl.pdf === null || pageIndex < 1 || pageIndex > _ctrl.pdf.numPages) {
								return;
							}

							_ctrl.pages[pageIndex - 1].container[0].scrollIntoView();
						},
						goToNextPage: function () {
							if(_ctrl.pdf === null) {
								return;
							}

							this.goToPage(viewer.currentPage + 1);
						},
						goToPrevPage: function () {
							if(_ctrl.pdf === null) {
								return;
							}

							this.goToPage(viewer.currentPage - 1);
						},
						getNumPages: function () {
							if(_ctrl.pdf === null) {
								return 0;
							}

							return _ctrl.pdf.numPages;
						},
						findNext: function () {
							if(_ctrl.searching) {
								return;
							}

							var nextHighlightID = viewer.searchResultId + 1;
							if(nextHighlightID > _ctrl.searchResults.length) {
								nextHighlightID = 1;
							}

							_ctrl.PDFViewer_highlightSearchResult(nextHighlightID - 1);
						},
						findPrev: function () {
							if(_ctrl.searching) {
								return;
							}

							var prevHighlightID = viewer.searchResultId - 1;
							if(prevHighlightID <= 0) {
								prevHighlightID = _ctrl.searchResults.length;
							}

							_ctrl.PDFViewer_highlightSearchResult(prevHighlightID - 1);
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
