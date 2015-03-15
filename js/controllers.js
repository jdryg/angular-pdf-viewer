(function (angular) {
	"use strict";
	
	angular.module("DemoApp.Controllers", []).
	controller("DemoController", ["$scope", "$sce", function ($scope, $sce) {
		$scope.pdfViewerAPI = {};
		$scope.pdfScale = 1.0;
		$scope.pdfURL = "pdf/demo.pdf";

		$scope.onPDFPageLoaded = function (page, totalPages, state) {
			console.log("onPDFPageLoaded(" + page + ", " + totalPages + ", " + state + ")");
			if(state === "success") {
				// TODO: Hide the loading progress indicator if it's visible.
			} else if(state === "error") {
				// TODO: ALERT!
			}
		};

		$scope.onPDFLoadProgress = function (loadedBytes, totalBytes, state) {
//			console.log("onPDFLoadProgress(" + loadedBytes + ", " + totalBytes + ", " + state + ")");
			if(state === "loading") {
				// TODO: Update progress indicator...
			} else if(state === "error") {
				// TODO: ALERT!!!!
				// NOTE: In this case
			}
		};

		$scope.zoomIn = function () {
			console.log("zoomIn()");
			$scope.pdfScale = $scope.pdfViewerAPI.zoomIn();
		};

		$scope.zoomOut = function () {
			console.log("zoomOut()");
			$scope.pdfScale = $scope.pdfViewerAPI.zoomOut();
		};

		$scope.trustSrc = function(src) {
			return $sce.trustAsResourceUrl(src);
		};
	}]);
})(angular);
