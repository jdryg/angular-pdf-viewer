/*
 * angular-pdf-viewer v1.0.0
 * https://github.com/jdryg/angular-pdf-viewer
 */
(function (angular, PDFJS) {
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
			
		return {
			restrict: "E",
			scope: {
				src: "@",
				api: "=",
				initialScale: "@",
				progressCallback: "&"
			},
			controller: ['$scope', '$element', function ($scope, $element) {
				$scope.pdf = null;
				$scope.pages = [];
				$scope.scale = 1.0;
				$scope.fitWidthScale = 1.0;
				$scope.fitPageScale = 1.0;

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
						h = 20;
					}

					// HACK: Allow some space around page.
					// Q: Should this be configurable by the client?
					w -= 20;
					h -= 20;

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

				$scope.passwordCallback = function (passwordFunc, reason) {
					// TODO: Inform the client that this PDF is password protected...
					passwordFunc("");
				};

				$scope.getAllPDFPages = function (pdf, callback) {
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

				$scope.renderPDFPage = function (pageID, scale) {
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
						});
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
					for(var iPage = 0;iPage < numPages;++iPage) {
						var page = $scope.pages[iPage];

						if(!page.rendered && $scope.isPageInViewport(page.container)) {
							atLeastOnePageInViewport = true;

							$scope.renderPDFPage(iPage, $scope.scale);
						} else {
							if(atLeastOnePageInViewport) {
								break;
							}
						}
					}
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

					$scope.renderAllVisiblePages();
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
					$element.empty();

					var getDocumentTask = PDFJS.getDocument($scope.src, null, $scope.passwordCallback, $scope.downloadProgress);
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

				$element.bind("scroll", function (event) {
					$scope.renderAllVisiblePages();
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
						console.log("PDF viewer API: zoomTo(" + scale + ")");
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
