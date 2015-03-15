/*
 * angular-pdf-viewer v1.0.0
 * https://github.com/jdryg/angular-pdf-viewer
 */
(function (angular, PDFJS) {
	"use strict";

	angular.module("angular-pdf-viewer", []).
	directive("pdfViewer", [function () {
		return {
			restrict: "E",
			scope: {
				src: "@",
				api: "=",
				initialScale: "@"
			},
			controller: ['$scope', '$element', function ($scope, $element) {
				$scope.pdf = null;
				$scope.pages = [];
				$scope.scale = 1.0;

				var getContainerSize = function () {
					// NOTE: Create a tall temp element, add it to the $element
					// and calculate the width. This way we can take into account 
					// the scrollbar width.
					var tallTempElement = angular.element("<div></div>");
					tallTempElement.css("height", "10000px");
					$element.append(tallTempElement);

					// NOTE: jQuery function
					var w = tallTempElement.width();

					tallTempElement.remove();

					// NOTE: jQuery function
					var h = $element.height();
					if(h === 0) {
						// TODO: Should we get the parent height?
						h = 20;
					}

					// HACK: Allow some space around page.
					w -= 20;
					h -= 20;

					return {
						width: w,
						height: h
					};
				};

				var documentProgress = function (progressData) {
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

					// TODO: Inform the client about the progress...
					console.log("Downloaded " + progressData.loaded + " of " + total);
				};

				var passwordCallback = function (passwordFunc, reason) {
					console.log("Password protected PDF. PDF.js reason: " + reason);

					// TODO: Inform the client that this PDF is password protected...
					passwordFunc("");
				};

				var getAllPDFPages = function (pdf, callback) {
					var pageList = [];

					var remainingPages = pdf.numPages;
					for(var iPage = 0;iPage < pdf.numPages;++iPage) {
						pageList.push({});

						var getPageTask = $scope.pdf.getPage(iPage + 1);
						getPageTask.then(function (page) {
							var pageContainer = angular.element("<div></div>");
							pageContainer.addClass("page");
							pageContainer.attr("id", "page_" + page.pageIndex);

							var canvasElement = angular.element("<canvas></canvas>");
							var textLayerElement = angular.element("<div></div>");
							textLayerElement.addClass("text-layer");

							pageList[page.pageIndex] = {
								id: page.pageIndex + 1,
								pdfPage: page,
								container: pageContainer,
								canvas: canvasElement,
								textLayer: textLayerElement,
								rendered: false
							};

							--remainingPages;
							if(remainingPages === 0) {
								callback(pageList);
							}
						});
					}
				};

				var resizePDFPageToScale = function (page, scale) {
					var viewport = page.pdfPage.getViewport(scale);

					page.container.css("width", viewport.width + "px");
					page.container.css("height", viewport.height + "px");

					page.canvas.attr("width", viewport.width);
					page.canvas.attr("height", viewport.height);

					page.textLayer.css("width", viewport.width + "px");
					page.textLayer.css("height", viewport.height + "px");
				};

				var calcPDFScale = function (pageList, desiredScale, containerWidth, containerHeight) {
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

					return parseFloat(desiredScale);
				};

				$scope.isPageInViewport = function (pageContainer) {
					var pageStartY = pageContainer.position().top;//pageContainer.offset().top - $element.offset().top;
//					var pageStartY = pageContainer.offset().top - $element.offset().top;
					var pageEndY = pageStartY + pageContainer.height();

					return pageEndY >= 0.0 && pageStartY <= $element.height();
				};

				$scope.renderPDFPage = function (pageID, scale) {
					var page = $scope.pages[pageID];
					var viewport = page.pdfPage.getViewport(scale);

					// NOTE: We mark the page as rendered here because the renderTask 
					// might not have finished when we get in here again (e.g. due to scrolling).
					page.rendered = true;

					var renderTask = page.pdfPage.render({
						canvasContext: page.canvas[0].getContext('2d'),
						viewport: viewport
					});

					renderTask.then(function () {
						page.container.append(page.canvas);

						// TODO: Optional text layer...
						var textContentTask = page.pdfPage.getTextContent();
						textContentTask.then(function (textContent) {
							var textLayerBuilder = new TextLayerBuilder({
								textLayerDiv: page.textLayer[0],
								pageIndex: pageID,
								viewport: viewport
							});

							textLayerBuilder.setTextContent(textContent);
							textLayerBuilder.renderLayer();

							page.container.append(page.textLayer);

							// TODO: Inform the client that the page has been rendered.
							console.log("PDF viewer: page " + (pageID + 1) + " rendered successfully.");
						});
					}, function (message) {
						page.rendered = false;
						
						// TODO: Inform the client that something went wrong while rendering the specified page!
						console.log("PDF.js page render failed. Message: " + message);
					});
				};

				$scope.onPDFScaleChanged = function (scale) {
					$scope.scale = scale;

					var numPages = $scope.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						resizePDFPageToScale($scope.pages[iPage], scale);
					}

					// Render all visible pages...
					for(var iPage = 0;iPage < numPages;++iPage) {
						var page = $scope.pages[iPage];
						
						// Clear the page...
						page.rendered = false;
						page.container.empty();
						page.textLayer.empty();
						
						if($scope.isPageInViewport(page.container)) {
							$scope.renderPDFPage(iPage, scale);
						}
					}
					
					return scale;
				};

				$scope.onContainerSizeChanged = function (containerSize) {
					var scale = calcPDFScale($scope.pages, $scope.initialScale, containerSize.width, containerSize.height);
					$scope.onPDFScaleChanged(scale);
				};

				$scope.onPDFSrcChanged = function () {
					// TODO: Set the correct flag based on client's choice.
					PDFJS.disableTextLayer = false;

					// Since the PDF has changed we must clear the $element.
					$scope.pages = [];
					$element.empty();

					var getDocumentTask = PDFJS.getDocument($scope.src, null, passwordCallback, documentProgress);
					getDocumentTask.then(function (pdf) {
						$scope.pdf = pdf;

						// Get all the pages...
						getAllPDFPages(pdf, function (pageList) {
							$scope.pages = pageList;

							// Append all page containers to the $element...
							for(var iPage = 0;iPage < pageList.length; ++iPage) {
								$element.append($scope.pages[iPage].container);
							}

							var containerSize = getContainerSize();
							$scope.onContainerSizeChanged(containerSize);
						});
					}, function (message) {
						// TODO: Inform the client that something went wrong and we couldn't read the specified pdf.
						console.log("PDFJS.getDocument() failed. Message: " + message);
					});
				};
				
				$element.bind("scroll", function (event) {
					console.log("PDF viewer scrolled");

					// TODO: This seems to be very slow (too much time spend in jQuery). Investigate.
					console.time("onScroll");
					var numPages = $scope.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						var page = $scope.pages[iPage];
						
						if(!page.rendered && $scope.isPageInViewport(page.container)) {
							$scope.renderPDFPage(iPage, $scope.scale);
						}
					}
					console.timeEnd("onScroll");
				});

				// API...
				$scope.api = {
					zoomIn: function () {
						console.log("PDF viewer API: zoomIn()");
						// TODO: Fix this...
						return $scope.onPDFScaleChanged($scope.scale * 1.25);
					},
					zoomOut: function () {
						console.log("PDF viewer API: zoomOut()");
						return $scope.onPDFScaleChanged($scope.scale / 1.25);
					},
					zoomTo: function (scale) {
						console.log("PDF viewer API: zoomTo(" + scale + ")");
						return $scope.onPDFScaleChanged(scale);
					},
					goToPage: function (pageIndex) {
						console.log("PDF viewer API: goToPage(" + pageIndex + ")");
					}
				};
			}],
			link: function (scope, element, attrs) {
				attrs.$observe('src', function (src) {
					console.log("PDF viewer: src changed to " + src);
					if (src !== undefined && src !== null && src !== '') {
						scope.onPDFSrcChanged();
					}
				});
			}
		};
	}]);
})(angular, PDFJS);
