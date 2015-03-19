(function (angular, document) {
	"use strict";

	angular.module("DemoApp.Controllers", []).
	controller("DemoController", ["$scope", "$sce", function ($scope, $sce) {
		$scope.isLoading = false;
		$scope.downloadProgress = 0;

		$scope.pdfZoomLevels = [];
		$scope.pdfViewerAPI = {};
		$scope.pdfScale = 1;
		$scope.pdfURL = "";
		$scope.pdfFile = null;
		$scope.pdfTotalPages = 0;
		$scope.pdfCurrentPage = 0;
		$scope.pdfSearchTerm = "";
		$scope.pdfSearchResultID = 0;
		$scope.pdfSearchNumOccurences = 0;

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
					
					$scope.pdfCurrentPage = 1;
					$scope.pdfTotalPages = $scope.pdfViewerAPI.getNumPages();
					$scope.pdfScale = $scope.pdfViewerAPI.getZoomLevel();
					$scope.isLoading = false;
				} else {
					alert("Failed to render 1st page!\n\n" + message);
					$scope.isLoading = false;
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

		$scope.onPDFPageChanged = function () {
			$scope.pdfViewerAPI.goToPage($scope.pdfCurrentPage);
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
			if($scope.pdfURL === pdfURL) {
				return;
			}

			$scope.isLoading = true;
			$scope.downloadProgress = 0;
			$scope.pdfZoomLevels = [];
			$scope.pdfSearchTerm = "";
			$scope.pdfFile = null;
			$scope.pdfURL = pdfURL;
		};
				
		$scope.findNext = function () {
			$scope.pdfViewerAPI.findNext();
		};
		
		$scope.findPrev = function () {
			$scope.pdfViewerAPI.findPrev();
		};

		$scope.onPDFFileChanged = function () {
			$scope.isLoading = true;
			$scope.downloadProgress = 0;
			$scope.pdfZoomLevels = [];
			$scope.pdfSearchTerm = "";

			$scope.$apply(function () {
				$scope.pdfURL = "";
				$scope.pdfFile = document.getElementById('file_input').files[0];
			});
		};
		
		$scope.onPDFPassword = function (reason) {
			return prompt("The selected PDF is password protected. PDF.js reason: " + reason, "");
		};

		$scope.trustSrc = function(src) {
			return $sce.trustAsResourceUrl(src);
		};

		$scope.switchToPDF = function (pdfID) {
			if(pdfID === 0) {
				$scope.loadPDF("pdf/demo.pdf");
			} else if(pdfID === 1) {
				$scope.loadPDF("pdf/demo_large.pdf");
			}
		};

		$scope.loadPDF("pdf/demo.pdf");
	}]);
})(angular, document);
