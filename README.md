# angular-pdf-viewer
Just another Angular directive for displaying PDF files using PDF.js

[Live demo](http://jdryg.github.io/angular-pdf-viewer)

#### Features
- Continuous view (all pages are inserted into the DOM when the PDF is loaded)
- Lazy page rendering (render a page only when it enters the viewport for the first time. As of v1.1.2 pages far away from the current viewport are removed, to minimize memory usage; it seems to help with large PDF files).
- Text layer (optional)
- Zoom to
 * Value
 * Fit the width of the widest page
 * Fit the height of 1st page
- Jump to page
- Password protected PDFs
- Searching (with highlighting; requires the text layer)

#### Directive attributes
- src: (input) URL to the PDF file
- file: (input) File object obtained from an input field. See demo for details.
- current-page: (output) The current page index (in case you want to show the number somewhere in your UI)
- initial-scale: (input) The initial zoom level of the document. Either "fit_width", "fit_height" or a floating point value.
- progress-callback: (input) A function which will be called everytime something changes (e.g. download progress, page rendering progress or errors from those operations).
- password-callback: (input) A function which will be called when trying to open a password protected PDF. Should return the correct password or null in case you don't have a password. 
- render-text-layer: (input) Boolean indicating whether you want to generate the text layer for each page.
- search-term: (input) Text to search inside the PDF
- search-result-id: (output) The currently selected search result index.
- search-num-occurences: (output) The number of occurences of the currently specified search term.
- api: (output) An object with several functions you can use to communicate with the directive.

Note that you can specify only one of the 'src' and 'file' attributes. In case you want to use both, you have to make sure you null out the other one, because the update order is not guaranteed.

Search functionality requires the text layer to be present.

See partials/demo.html for details on the directive syntax and js/controllers.js for details on how to use the directive API and the progress callback.

#### Styling

TODO

#### Dependencies
- Angular.js
- PDF.js (including text_layer_builder.js and ui_utils.js from the src distribution)

#### License
angular-pdf-viewer.js is copyright © 2015 The owner of this repo.
The rest of the code (PDF.js, Angular.js, etc.) isn't covered by this license!

angular-pdf-viewer.js is free. You can redistribute it and/or modify it under the terms of the Do What The Fuck You Want To Public License, Version 2, as published by Sam Hocevar. See the COPYING file for more details.

[WTFPL](http://www.wtfpl.net/)
