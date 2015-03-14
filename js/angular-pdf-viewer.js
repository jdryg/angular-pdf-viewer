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
				src: '@'
			},
			controller: ['$scope', '$element', function ($scope, $element) {
				$scope.pdf = null;
				$scope.pages = [];
				$scope.scale = "2.0";

				var getContainerSize = function () {
					var tallTempElement = angular.element("<div></div>");
					tallTempElement.css("height", "10000px");
					$element.append(tallTempElement);

					var w = tallTempElement.width();

					tallTempElement.remove();

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
						pageList.push({
							id: iPage + 1,
							pdfPage: null,
							element: null
						});

						var getPageTask = $scope.pdf.getPage(iPage + 1);
						getPageTask.then(function (page) {
							var pageContainer = angular.element("<div></div>");
							pageContainer.addClass("page");
							pageContainer.attr("id", "page_" + page.pageIndex);

							var canvasElement = angular.element("<canvas></canvas>");
							var textLayerElement = angular.element("<div></div>");
							textLayerElement.addClass("text-layer");

							pageContainer.append(canvasElement);
							pageContainer.append(textLayerElement);

							pageList[page.pageIndex].pdfPage = page;
							pageList[page.pageIndex].element = pageContainer;

							--remainingPages;
							if(remainingPages === 0) {
								callback(pageList);
							}
						});
					}
				};
				
				var resizePDFPageToScale = function (page, scale) {
					var viewport = page.pdfPage.getViewport(scale);

					var canvasElement = page.element.find("canvas");
					canvasElement.attr("width", viewport.width);
					canvasElement.attr("height", viewport.height);

					var textLayerElement = page.element.find("div");
					textLayerElement.css("width", viewport.width + "px");
					textLayerElement.css("height", viewport.height + "px");

					page.element.css("width", viewport.width + "px");
				};
				
				var calcPDFPageScale = function (pageList, desiredScale, containerWidth, containerHeight) {
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
				
				$scope.onContainerSizeChanged = function (containerSize) {
					$element.empty();

					var scale = calcPDFPageScale($scope.pages, $scope.scale, containerSize.width, containerSize.height);

					var numPages = $scope.pages.length;
					for(var iPage = 0;iPage < numPages;++iPage) {
						resizePDFPageToScale($scope.pages[iPage], scale);
						$element.append($scope.pages[iPage].element);
						
						// TODO: Render the page if it's in the viewport otherwise leave it for later...
					}
				};

				$scope.onPDFSrcChanged = function () {
					// TODO: Set the correct flag based on client's choice.
					PDFJS.disableTextLayer = false;

					// Remove all $element's children...
					$scope.pages = [];
					$element.empty();

					var getDocumentTask = PDFJS.getDocument($scope.src, null, passwordCallback, documentProgress);
					getDocumentTask.then(function (pdf) {
						$scope.pdf = pdf;

						// Get all the pages...
						getAllPDFPages(pdf, function (pageList) {
							$scope.pages = pageList;

							var containerSize = getContainerSize();
							$scope.onContainerSizeChanged(containerSize);
						});
					}, function (message) {
						// TODO: Inform the client that something went wrong and we couldn't read the specified pdf.
						console.log("PDFJS.getDocument() failed. Message: " + message);
					});
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
