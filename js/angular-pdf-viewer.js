/*
 * angular-pdf-viewer v1.2.1
 * https://github.com/jdryg/angular-pdf-viewer
 */
(function (angular, PDFJS, document) {
	"use strict";

	/**
	 * Returns the inner size of the element taking into account the vertical scrollbar that will
	 * appear if the element gets really tall. 
	 * 
	 * @argument {element} element The element we are calculating its inner size
	 * @argument {integer} margin Margin around the element (subtracted from the element's size)
	 */ 
	function getElementInnerSize(element, margin) {
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
	}

	function trim1 (str) {
		return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
	}

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

	// PDFPage.render() results...
	var PDF_PAGE_RENDER_FAILED = -1;
	var PDF_PAGE_RENDER_CANCELLED = 0;
	var PDF_PAGE_RENDERED = 1;
	var PDF_PAGE_ALREADY_RENDERED = 2;

	// A LUT for zoom levels (because I cannot find a formula that works in all cases).
	var PDF_ZOOM_LEVELS_LUT= [
		0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 
		1.0, 1.1, 1.3, 1.5, 1.7, 1.9, 
		2.0, 2.2, 2.4, 2.6, 2.8, 
		3.0, 3.3, 3.6, 3.9,
		4.0, 4.5,
		5.0
	];

	function PDFPage(pdfPage, textContent) {
		this.id = pdfPage.pageIndex + 1;
		this.container = angular.element("<div class='page'></div>");
		this.container.attr("id", "page_" + pdfPage.pageIndex);

		this.canvas = angular.element("<canvas></canvas>");
		this.textLayer = angular.element("<div class='text-layer'></div>");

		this.pdfPage = pdfPage;
		this.textContent = textContent;
		this.rendered = false;
		this.renderTask = null;
	}
	
	PDFPage.prototype = {
		clear: function () {
			if(this.renderTask !== null) {
				this.renderTask.cancel();
			}

			this.rendered = false;
			this.renderTask = null;
			this.textLayer.empty();
			this.container.empty();
		},
		resize: function (scale) {
			var viewport = this.pdfPage.getViewport(scale);

			this.canvas.attr("width", viewport.width);
			this.canvas.attr("height", viewport.height);

			this.container.css("width", viewport.width + "px");
			this.container.css("height", viewport.height + "px");

			this.textLayer.css("width", viewport.width + "px");
			this.textLayer.css("height", viewport.height + "px");
		},
		isVisible: function () {
			var pageContainer = this.container[0];
			var parentContainer = this.container.parent()[0];

			var pageTop = pageContainer.offsetTop - parentContainer.scrollTop;
			var pageBottom = pageTop + pageContainer.offsetHeight;

			return pageBottom >= 0 && pageTop <= parentContainer.offsetHeight;
		},
		highlightTextItem: function (itemID, matchPos, text) {
			var textLayer = this.textLayer;
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
			var parentContainer = this.container.parent()[0];
			
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
		},
		render: function (scale, linkService, callback) {
			var self = this;
			if(this.rendered) {
				if(this.renderTask === null) {
					if(callback) {
						callback(this, PDF_PAGE_ALREADY_RENDERED);
					}
				} else {
					this.renderTask.then(function () {
						if(callback) {
							callback(self, PDF_PAGE_ALREADY_RENDERED);
						}
					});
				}

				return;
			}

			var viewport = this.pdfPage.getViewport(scale);

			this.rendered = true;

			this.renderTask = this.pdfPage.render({
				canvasContext: this.canvas[0].getContext('2d'),
				viewport: viewport
			});

			this.renderTask.then(function () {
				self.rendered = true;
				self.renderTask = null;

				self.container.append(self.canvas);

				if(self.textContent) {
					// Render the text layer...
					var textLayerBuilder = new TextLayerBuilder({
						textLayerDiv: self.textLayer[0],
						pageIndex: self.id,
						viewport: viewport
					});

					textLayerBuilder.setTextContent(self.textContent);
					textLayerBuilder.renderLayer();
					self.container.append(self.textLayer);

					if(linkService) {
						// Render the annotation layer...
						// NOTE: Annotation div is inserted into the page div iff
						// there are annotations in the current page. This is 
						// handled by the AnnotationLayerBuilder.
						var annotationLayerBuilder = new AnnotationsLayerBuilder({
							pageDiv: self.container[0],
							pdfPage: self.pdfPage,
							linkService: linkService
						});

						annotationLayerBuilder.setupAnnotations(viewport);
					}
				}

				if(callback) {
					callback(self, PDF_PAGE_RENDERED);
				}
			}, function (message) {
				self.rendered = false;
				self.renderTask = null;

				if(message === "cancelled") {
					if(callback) {
						callback(self, PDF_PAGE_RENDER_CANCELLED);
					}
				} else {
					if(callback) {
						callback(self, PDF_PAGE_RENDER_FAILED);
					}
				}
			});
		}
	};

	function PDFViewer() {
		this.pdf = null;
		this.pages = [];
		this.scale = 1.0;
		this.pdfLinkService = null;
		this.pagesRefMap = {};
		this.hasTextLayer = false;
		this.searchResults = [];
		this.searchTerm = "";
		this.searchHighlightResultID = -1;
		this.fitWidthScale = 1.0;
		this.fitPageScale = 1.0;
		this.element = null;
		this.pageMargin = 0;
		this.currentPage = 0;
		
		this.api = new PDFViewerAPI(this);

		// Hooks for the client...
		this.onSearch = null;
		this.onPageRendered = null;
		this.onDataDownloaded = null;
		this.onCurrentPageChanged = null;
		this.passwordCallback = null;
	}

	PDFViewer.prototype = {
		setUrl: function (url, element, initialScale, renderTextLayer, pageMargin) {
			this.resetSearch();
			this.pages = [];
			this.pdfLinkService = null;
			this.pagesRefMap = {};
			this.hasTextLayer = renderTextLayer;
			this.element = element;
			this.pageMargin = pageMargin;
			
			var self = this;
			var getDocumentTask = PDFJS.getDocument(url, null, angular.bind(this, this.passwordCallback), angular.bind(this, this.downloadProgress));
			getDocumentTask.then(function (pdf) {
				self.pdf = pdf;

				// Get all the pages...
				self.getAllPages(pdf, renderTextLayer, function (pageList, pagesRefMap) {
					self.pages = pageList;
					self.pagesRefMap = pagesRefMap;
					self.pdfLinkService = new PDFLinkService(pagesRefMap, self.api);

					// Append all page containers to the $element...
					for(var iPage = 0;iPage < pageList.length; ++iPage) {
						element.append(pageList[iPage].container);
					}

					var containerSize = getElementInnerSize(element, pageMargin);
					self.setContainerSize(initialScale, containerSize);
				});
			}, function (message) {
				self.onDataDownloaded("failed", 0, 0, "PDF.js: " + message);
			});
		},
		setFile: function (file, element, initialScale, renderTextLayer, pageMargin) {
			this.resetSearch();
			this.pages = [];
			this.pdfLinkService = null;
			this.pagesRefMap = {};
			this.hasTextLayer = renderTextLayer;
			this.element = element;
			this.pageMargin = pageMargin;

			var self = this;
			var reader = new FileReader();
			reader.onload = function(e) {
				var arrayBuffer = e.target.result;
				var uint8Array = new Uint8Array(arrayBuffer);

				var getDocumentTask = PDFJS.getDocument(uint8Array, null, angular.bind(self, self.passwordCallback), angular.bind(self, self.downloadProgress));
				getDocumentTask.then(function (pdf) {
					self.pdf = pdf;

					// Get all the pages...
					self.getAllPages(pdf, renderTextLayer, function (pageList, pagesRefMap) {
						self.pages = pageList;
						self.pagesRefMap = pagesRefMap;
						self.pdfLinkService = new PDFLinkService(pagesRefMap, self.api);

						// Append all page containers to the $element...
						for(var iPage = 0;iPage < pageList.length; ++iPage) {
							element.append(pageList[iPage].container);
						}

						var containerSize = getElementInnerSize(element, pageMargin);
						self.setContainerSize(initialScale, containerSize);
					});
				}, function (message) {
					self.onDataDownloaded("failed", 0, 0, "PDF.js: " + message);
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

					self.onDataDownloaded("failed", 0, 0, message);
				}
			};

			reader.readAsArrayBuffer(file);
		},
		getAPI: function () {
			return this.api;
		},
		getAllPages: function (pdf, hasTextLayer, callback) {
			var pageList = [],
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
							pageList[page.pageIndex] = new PDFPage(page, textContent);

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
						pageList[page.pageIndex] = new PDFPage(page, null);

						--remainingPages;
						if(remainingPages === 0) {
							callback(pageList, pagesRefMap);
						}
					});
				}
			}
		},
		setContainerSize: function (initialScale, containerSize) {
			this.fitWidthScale = this.calcScale("fit_width", containerSize);
			this.fitPageScale = this.calcScale("fit_page", containerSize);

			this.setScale(this.calcScale(initialScale, containerSize));
		},
		setScale: function (scale) {
			this.scale = scale;

			var numPages = this.pages.length;
			for(var iPage = 0;iPage < numPages;++iPage) {
				// Clear the page's contents...
				this.pages[iPage].clear();

				// Resize to current scale...
				this.pages[iPage].resize(scale);
			}

			this.highlightSearchResult(this.searchHighlightResultID);
			this.renderAllVisiblePages(0);
		},
		calcScale: function (desiredScale, containerSize) {
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
		},
		removeDistantPages: function (curPageID, distance) {
			var numPages = this.pages.length;

			var firstActivePageID = Math.max(curPageID - distance, 0);
			var lastActivePageID = Math.min(curPageID + distance, numPages - 1);

			for(var iPage = 0;iPage < firstActivePageID;++iPage) {
				this.pages[iPage].clear();
			}

			for(var iPage = lastActivePageID + 1;iPage < numPages;++iPage) {
				this.pages[iPage].clear();
			}
		},
		renderAllVisiblePages: function (scrollDir) {
			var self = this;
			var numPages = this.pages.length;
			var currentPageID = 0;

			var atLeastOnePageInViewport = false;
			for(var iPage = 0;iPage < numPages;++iPage) {
				var page = this.pages[iPage];

				if(page.isVisible()) {
					var parentContainer = page.container.parent()[0];
					var pageTop = page.container[0].offsetTop - parentContainer.scrollTop;
					if(pageTop <= parentContainer.offsetHeight / 2) {
						currentPageID = iPage;
					}

					atLeastOnePageInViewport = true;
					page.render(this.scale, this.pdfLinkService, function (page, status) {
						if(status === PDF_PAGE_RENDERED) {
							self.onPageRendered("success", page.id, self.pdf.numPages, "");
						} else if (status === PDF_PAGE_RENDER_FAILED) {
							self.onPageRendered("failed", page.id, self.pdf.numPages, "Failed to render page.");
						}
					});
				} else {
					if(atLeastOnePageInViewport) {
						break;
					}
				}
			}

			if(scrollDir !== 0) {
				var nextPageID = currentPageID + scrollDir;
				if(nextPageID >= 0 && nextPageID < numPages) {
					this.pages[nextPageID].render(this.scale, this.pdfLinkService, function (page, status) {
						if(status === PDF_PAGE_RENDERED) {
							self.onPageRendered("success", page.id, self.pdf.numPages, "");
						} else if (status === PDF_PAGE_RENDER_FAILED) {
							self.onPageRendered("failed", page.id, self.pdf.numPages, "Failed to render page.");
						}
					});
				}
			}

			this.removeDistantPages(currentPageID, 5);

			this.currentPage = currentPageID + 1;
			this.onCurrentPageChanged(currentPageID + 1);
		},
		resetSearch: function () {
			this.clearLastSearchHighlight();
		
			this.searchResults = [];
			this.searchTerm = "";
			this.searchHighlightResultID = -1;

			this.onSearch("reset", 0, 0, "");
		},
		search: function (text) {
			if(!this.hasTextLayer) {
				this.onSearch("failed", 0, 0, "The viewer doesn't have a text layer.");
				return;
			}

			this.resetSearch();
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
				this.highlightSearchResult(0);
			} else {
				this.onSearch("done", 0, 0, text);
			}
		},
		highlightSearchResult: function (resultID) {
			if(!this.hasTextLayer) {
				this.onSearch("failed", 0, 0, "The viewer doesn't have a text layer.");
				return;
			}

			var self = this;
			var prevHighlightID = this.searchHighlightResultID;

			this.clearLastSearchHighlight();

			if(resultID < 0 || resultID >= this.searchResults.length) {
				if(resultID === -1 && this.searchResults.length === 0) {
					this.onSearch("done", -1, 0, this.searchTerm);
				} else {
					this.onSearch("failed", resultID, this.searchResults.length, "Invalid search result index");
				}

				return;
			}

			var result = this.searchResults[resultID];
			if(result.pageID < 0 || result.pageID >= this.pages.length) {
				this.onSearch("failed", resultID, this.searchResults.length, "Invalid page index in search result");
				return;
			}

			var self = this;
			this.pages[result.pageID].render(this.scale, this.pdfLinkService, function (page, status) {
				if(status === PDF_PAGE_RENDER_FAILED) {
					self.onPageRendered("failed", page.id, self.pdf.numPages, "Failed to render page.");
				} else if(status === PDF_PAGE_RENDER_CANCELLED) {
					// Revert to the previous result index because otherwise searching might get stuck.
					self.searchHighlightResultID = prevHighlightID;
				} else {
					if(status === PDF_PAGE_RENDERED) {
						self.onPageRendered("success", page.id, self.pdf.numPages, "");
					}

					page.highlightTextItem(result.itemID, result.matchPos, self.searchTerm);

					self.searchHighlightResultID = resultID;
					self.onSearch("done", self.searchHighlightResultID, self.searchResults.length, self.searchTerm);
				}
			});
		},
		clearLastSearchHighlight: function () {
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
		},
		downloadProgress: function (progressData) {
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

			this.onDataDownloaded("loading", progressData.loaded, total, "");
		}
	};
	
	function PDFViewerAPI(viewer) {
		this.viewer = viewer;
	};
	
	PDFViewerAPI.prototype = {
		getNextZoomInScale: function (scale) {
			var newScale = scale;
			var numZoomLevels = PDF_ZOOM_LEVELS_LUT.length;
			for(var i = 0;i < numZoomLevels;++i) {
				if(PDF_ZOOM_LEVELS_LUT[i] > scale) {
					newScale = PDF_ZOOM_LEVELS_LUT[i];
					break;
				}
			}

			if(scale < this.viewer.fitWidthScale && newScale > this.viewer.fitWidthScale) {
				return {
					value: this.viewer.fitWidthScale,
					label: "Fit width"
				};
			} else if(scale < this.viewer.fitPageScale && newScale > this.viewer.fitPageScale) {
				return {
					value: this.viewer.fitPageScale,
					label: "Fit page"
				};
			}

			return {
				value: newScale,
				label: (newScale * 100.0).toFixed(0) + "%"
			};
		},
		getNextZoomOutScale: function (scale) {
			var newScale = scale;
			var numZoomLevels = PDF_ZOOM_LEVELS_LUT.length;
			for(var i = numZoomLevels - 1; i >= 0;--i) {
				if(PDF_ZOOM_LEVELS_LUT[i] < scale) {
					newScale = PDF_ZOOM_LEVELS_LUT[i];
					break;
				}
			}

			if(scale > this.viewer.fitWidthScale && newScale < this.viewer.fitWidthScale) {
				return {
					value: this.viewer.fitWidthScale,
					label: "Fit width"
				};
			} else if(scale > this.viewer.fitPageScale && newScale < this.viewer.fitPageScale) {
				return {
					value: this.viewer.fitPageScale,
					label: "Fit page"
				};
			}

			return {
				value: newScale,
				label: (newScale * 100.0).toFixed(0) + "%"
			};
		},
		zoomTo: function (scale) {
			// TODO: Move this inside PDFViewer.setScale()
			if(isNaN(parseFloat(scale))) {
				// scale isn't a valid floating point number. Let
				// calcScale() handle it (e.g. fit_width or fit_page).
				var containerSize = getElementInnerSize(this.viewer.element, this.viewer.pageMargin);
				scale = this.viewer.calcScale(scale, containerSize);
			}

			this.viewer.setScale(scale);
		},
		getZoomLevel: function () {
			return this.viewer.scale;
		},
		goToPage: function (pageIndex) {
			if(this.viewer.pdf === null || pageIndex < 1 || pageIndex > this.viewer.pdf.numPages) {
				return;
			}

			this.viewer.pages[pageIndex - 1].container[0].scrollIntoView();
		},
		goToNextPage: function () {
			if(this.viewer.pdf === null) {
				return;
			}

			this.goToPage(this.viewer.currentPage + 1);
		},
		goToPrevPage: function () {
			if(this.viewer.pdf === null) {
				return;
			}

			this.goToPage(this.viewer.currentPage - 1);
		},
		getNumPages: function () {
			if(this.viewer.pdf === null) {
				return 0;
			}

			return this.viewer.pdf.numPages;
		},
		findNext: function () {
			if(this.viewer.searchHighlightResultID === -1) {
				return;
			}

			var nextHighlightID = this.viewer.searchHighlightResultID + 1;
			if(nextHighlightID >= this.viewer.searchResults.length) {
				nextHighlightID = 0;
			}

			this.viewer.highlightSearchResult(nextHighlightID);
		},
		findPrev: function () {
			if(this.viewer.searchHighlightResultID === -1) {
				return;
			}

			var prevHighlightID = this.viewer.searchHighlightResultID - 1;
			if(prevHighlightID < 0) {
				prevHighlightID = this.viewer.searchResults.length - 1;
			}

			this.viewer.highlightSearchResult(prevHighlightID);
		}	
	};

	angular.module("angular-pdf-viewer", []).
	directive("pdfViewer", [function () {
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
				$scope.lastScrollY = 0;

				$scope.onPageRendered = function (status, pageID, numPages, message) {
					this.onProgress("render", status, pageID, numPages, message);
				};

				$scope.onDataDownloaded = function (status, loaded, total, message) {
					this.onProgress("download", status, loaded, total, message);
				};

				$scope.onCurrentPageChanged = function (pageID) {
					this.currentPage = pageID;
				};

				$scope.onSearch = function (status, curResultID, totalResults, message) {
					if(status === "searching") {
					} else if(status === "failed") {
						console.log("Search failed: " + message);
					} else if(status === "done") {
						this.searchResultId = curResultID + 1;
						this.searchNumOccurences = totalResults;
					} else if(status === "reset") {
						this.searchResultId = 0;
						this.searchNumOccurences = 0;
					}
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

				$scope.viewer = new PDFViewer();
				$scope.viewer.onSearch = angular.bind($scope, $scope.onSearch);
				$scope.viewer.onPageRendered = angular.bind($scope, $scope.onPageRendered);
				$scope.viewer.onDataDownloaded = angular.bind($scope, $scope.onDataDownloaded);
				$scope.viewer.onCurrentPageChanged = angular.bind($scope, $scope.onCurrentPageChanged);
				$scope.viewer.passwordCallback = angular.bind($scope, $scope.getPDFPassword);
				
				$scope.api = $scope.viewer.getAPI();

				$scope.shouldRenderTextLayer = function () {
					if(this.renderTextLayer === "" || this.renderTextLayer === undefined || this.renderTextLayer === null || this.renderTextLayer.toLowerCase() === "false") {
						return false;
					}

					return true;
				};

				$scope.onPDFSrcChanged = function () {
					$element.empty();
					this.lastScrollY = 0;
					this.viewer.setUrl(this.src, $element, this.initialScale, this.shouldRenderTextLayer(), pageMargin);
				};

				$scope.onPDFFileChanged = function () {
					$element.empty();
					this.lastScrollY = 0;
					this.viewer.setFile(this.file, $element, this.initialScale, this.shouldRenderTextLayer(), pageMargin);
				};

				$element.bind("scroll", function (event) {
					$scope.$apply(function () {
						var scrollTop = $element[0].scrollTop;

						var scrollDir = scrollTop - $scope.lastScrollY;
						$scope.lastScrollY = scrollTop;

						var normalizedScrollDir = scrollDir > 0 ? 1 : (scrollDir < 0 ? -1 : 0);
						$scope.viewer.renderAllVisiblePages(normalizedScrollDir);
					});
				});
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
						scope.viewer.search(searchTerm);
					} else {
						scope.viewer.resetSearch();
					}
				});
			}
		};
	}]);
})(angular, PDFJS, document);
