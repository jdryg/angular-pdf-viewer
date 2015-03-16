(function (angular) {
	"use strict";

	angular.module("DemoApp.Controllers", []).
	controller("DemoController", ["$scope", "$sce", function ($scope, $sce) {
		$scope.isLoading = false;
		$scope.downloadProgress = 0;
		
		$scope.pdfZoomLevels = [];
		$scope.pdfViewerAPI = {};
		$scope.pdfScale = 1;
		$scope.pdfURL = "";

		$scope.onPDFProgress = function (operation, state, value, total, message) {
			console.log("onPDFProgress(" + operation + ", " + state + ", " + value + ", " + total + ")");
			if(operation === "render" && value === 1) {
				if(state === "success") {
					if($scope.pdfZoomLevels.length === 0) {
						// Read all the PDF zoom levels in order to populate the combobox...
						var lastScale = 0.1;
						do {
							var curScale = $scope.pdfViewerAPI.getNextZoomInScale(lastScale);
							if(curScale.value === lastScale) {
								break;
							}

							$scope.pdfZoomLevels.push(curScale);

							lastScale = curScale.value;
						} while(true);
					}

					$scope.pdfScale = $scope.pdfViewerAPI.getZoomLevel();
					$scope.isLoading = false;
				} else {
					alert("Failed to render 1st page!\n\n" + message);
				}
			} else if(operation === "download" && state === "loading") {
				$scope.downloadProgress = (value / total) * 100.0;
			} else {
				if(state === "failed") {
					alert("Something went really bad!\n\n" + message);
				}
			}
		};

		$scope.onPDFZoomLevelChanged = function () {
			$scope.pdfViewerAPI.zoomTo($scope.pdfScale);
		};

		$scope.zoomIn = function () {
//			console.log("zoomIn()");
			var nextScale = $scope.pdfViewerAPI.getNextZoomInScale($scope.pdfScale);
			$scope.pdfViewerAPI.zoomTo(nextScale.value);
			$scope.pdfScale = nextScale.value;
		};

		$scope.zoomOut = function () {
//			console.log("zoomOut()");
			var nextScale = $scope.pdfViewerAPI.getNextZoomOutScale($scope.pdfScale);
			$scope.pdfViewerAPI.zoomTo(nextScale.value);
			$scope.pdfScale = nextScale.value;
		};

		$scope.loadPDF = function (pdfURL) {
			$scope.isLoading = true;
			$scope.downloadProgress = 0;
			$scope.pdfZoomLevels = [];
			$scope.pdfURL = pdfURL;
		};

		$scope.trustSrc = function(src) {
			return $sce.trustAsResourceUrl(src);
		};

		$scope.loadPDF("pdf/demo.pdf");
	}]);
})(angular);
