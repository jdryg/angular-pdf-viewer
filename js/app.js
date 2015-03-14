(function (angular) {
	"use strict";
	
	var app = angular.module("DemoApp", [
		"DemoApp.Controllers",
		"ngRoute",
		"angular-pdf-viewer"
	]);
	
	app.config(['$routeProvider', function ($routeProvider) {
		$routeProvider.when("/demo", {
			templateUrl: "partials/demo.html",
			controller: "DemoController"
		});	

		$routeProvider.otherwise({
			redirectTo: "/demo"
		});
	}]);
})(angular);
