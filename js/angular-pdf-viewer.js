/*
 * angular-pdf-viewer v1.0.0
 * https://github.com/jdryg/angular-pdf-viewer
 */
(function (angular, PDFJS) {
	"use strict";

	function calcPDFPageViewportScale(desiredScale, viewerWidth, viewerHeight, page)
	{
		if(desiredScale === "fit_width") {
			var viewport = page.getViewport(1.0);

			return viewerWidth / viewport.width;
		} else if(desiredScale === "fit_page") {
			var viewport = page.getViewport(1.0);

			if(viewerHeight < viewerWidth) {
				return viewerHeight / viewport.height;
			} else {
				return viewerWidth / viewport.width;
			}
		}

		return parseFloat(desiredScale);
	};

	angular.module("angular-pdf-viewer", []).
	directive("pdfViewer", function () {
		return {
			restrict: "E",
			scope: {
				onPageLoaded: '&',
				loadProgress: '&',
				src: '@',
				scale: '='
			},
			controller: ['$scope', '$element', function ($scope, $element) {
				$scope.pdf = null;
				$scope.originalScale = $scope.scale;

				$scope.documentProgress = function (progressData) {
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

					if ($scope.loadProgress) {
						$scope.$apply(function () {
							$scope.loadProgress({ state: "loading", loaded: progressData.loaded, total: total });
						});
					}
				};

				$scope.passwordCallback = function (passwordFunc, reason) {
					// TODO: Get the password from the caller.
					passwordFunc("123456");
				};

				$scope.onPDFScaleChanged = function () {
					// Remove all $element's children...
					$element.empty();

					if($scope.pdf === null) {
						return;
					}

					// Render all pages...
					for(var iPage = 1;iPage <= $scope.pdf.numPages;++iPage) {
						// Create an empty page container div.
						var pageContainer = angular.element("<div class='page'></div>");

						// Append the page to the parent element...
						$element.append(pageContainer);

						$scope.renderPage($scope.pdf, iPage, $scope.scale, pageContainer);
					}
				};

				$scope.onPDFContainerChanged = function () {
					if($scope.pdf === null) {
						return;
					}

					// Determine the scale for all the pages based on the scale of the 1st page...
					var getPageTask = $scope.pdf.getPage(1);
					getPageTask.then(function (page) {
						var viewerWidth = $element.parent()[0].offsetWidth;
						var viewerHeight = $element.parent()[0].offsetHeight;

						// NOTE: Use the original scale here because otherwise we might incorrectly keep the
						// PDF from scaling to fit the container's width (fit_width) or height (fit_page).
						var scale = calcPDFPageViewportScale($scope.originalScale, viewerWidth, viewerHeight, page);

						// Force the viewer to be updated by changing the scale.
						$scope.$apply(function () {
							// HACK: Setting a value to $scope.scale will trigger the $watch and the code
							// will assume that the client is changing the scale (which means that we should 
							// also change the $scope.originalScale). So, keep the old originalScale, change the scale
							// and reset the originalScale to the old value.
							var originalScale = $scope.originalScale;
							$scope.scale = scale;
							$scope.originalScale = originalScale;
						});
					});
				};

				$scope.onPDFSrcChanged = function () {
					PDFJS.disableTextLayer = false;

					// Remove all $element's children...
					$element.empty();

					var getDocumentTask = PDFJS.getDocument($scope.src, null, $scope.passwordCallback, $scope.documentProgress);
					getDocumentTask.then(function (pdf) {
						$scope.pdf = pdf;

						$scope.onPDFContainerChanged();
					}, function (message) {
						// Inform the client that something went wrong we couldn't read the specified pdf.
						if ($scope.loadProgress) {
							$scope.$apply(function () {
								$scope.loadProgress({ state: "error", loaded: 0, total: 0, message: message });
							});
						}
					});
				};

				$scope.renderPage = function (pdfDoc, pageID, scale, pageContainer) {
					var getPageTask = pdfDoc.getPage(pageID);
					getPageTask.then(function (page) {
						var canvasElement = angular.element("<canvas></canvas>");
						var textLayerElement = angular.element("<div class='text-layer'></div>");

						var viewport = page.getViewport(scale);

						canvasElement.attr("width", viewport.width);
						canvasElement.attr("height", viewport.height);

						textLayerElement.css("width", viewport.width + "px");
						textLayerElement.css("height", viewport.height + "px");

						pageContainer.append(canvasElement);
						pageContainer.append(textLayerElement);
						pageContainer.css("width", viewport.width + "px");

						// TODO: Execute this only if and when the canvas for this page enters the viewport...
						var renderTask = page.render({
							canvasContext: canvasElement[0].getContext('2d'),
							viewport: viewport
						});

						renderTask.then(function () {
							// TODO: Optional text layer...
							var textContentTask = page.getTextContent();
							textContentTask.then(function (textContent) {
								var textLayerBuilder = new TextLayerBuilder({
									textLayerDiv: textLayerElement[0],
									pageIndex: pageID,
									viewport: viewport
								});

								textLayerBuilder.setTextContent(textContent);
								textLayerBuilder.renderLayer();

								if($scope.onPageLoaded) {
									$scope.onPageLoaded({ page: pageID, total: pdfDoc.numPages, state: "success" });
								}
							});
						}, function (message) {
							// Inform the client that something went wrong while rendering the specified page!
							if($scope.onPageLoaded) {
								$scope.onPageLoaded({ page: pageID, total: pdfDoc.numPages, state: "error", message: message });
							}
						});
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

				scope.$watch("scale", function (scale) {
					console.log("PDF viewer: scale changed to " + scope.scale);
					scope.originalScale = scope.scale;
					scope.onPDFScaleChanged();
				});
			}
		};
	});
})(angular, PDFJS);
