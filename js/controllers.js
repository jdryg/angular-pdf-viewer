(function (angular) {
	"use strict";
	
	angular.module("DemoApp.Controllers", []).
	controller("DemoController", ["$scope", function ($scope) {
		$scope.pdf_scale = "fit_page";

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
			console.log("zoomIn(" + $scope.pdf_scale + ")");
			$scope.pdf_scale *= 2.0;
		};

		$scope.zoomOut = function () {
			console.log("zoomOut(" + $scope.pdf_scale + ")");
			$scope.pdf_scale /= 2.0;
		};
	}]);
})(angular);
