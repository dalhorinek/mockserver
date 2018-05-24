== README ==

Mock server to serve mock data files.

It searches for files by requested path, it looks for file .data.json and .headers.json 
The content of the .data.json file is returned and if .headers.json file is preseent, these headers are used instead of default headers. 

== Installation ==

$ npm install 

== Usage == 

=== Modes ===
The server has 4 different modes. 

1) FULL_MOCK 
  - only .data.json files from given directory are served 

  $ server data

2) PROXY_FIRST 
  - when you specify a proxy server, it tries to proxy the request to the server, if it's successful, it returns the response from proxy
  - when there is a timeout on the proxy server, mock data are returned
  - when there are 3 or more failed attempts on proxy server, it automatically switches to FULL_MOCK mode 

  $ server data --proxy https://some.proxy.server --proxy-first

3) MOCK_FIRST 
  - it tries to read data from .data.json files and if the data is not present, it proxies the request to the proxy server

  $ server data --proxy https://some.proxy.server

4) FULL_PROXY 
  - it proxies all requests to the proxy server

  $ server data --proxy https://some.proxy.server --proxy-full 

=== Recording ===
If you use mode PROXY_FIRST, MOCK_FIRST or FULL_PROXY, you can specify --record option and this will 
record responses from the proxy server so you can use real data as mocks whne proxy is not available.
It just creates .data.json and .header.json files 

  $ server data --proxy https://some.proxy.server --proxy-first --record

=== Public and private context ===
If Authorization header is present, data are stored into /private folder, otherwise in /public folder. 
This enables to mock different requests on same endpoint with and without authorization

=== Func data file ===
You can also create a .func.js file, if this file is present, then it's loaded and it should contain a function.
A function that receives a request and returns data content. 

Example:
    some/endpoint.func.js 
    -----------------------

    function currentDate(request) {
      return (new Date()).toString()
    }

Now when you call /some/endpoint it will always return current date. 
If .func.js and .data.json are both present, .func.js is picked as first option

== Post data specific response ==
For every POST request a numeric hash is calculated and mock server looks first for a file with this
hash in it's name, like some/endpoint.12345.data.raw or some/endpoint.12345.headers.json, if no such file is present,
it will try to load data/headers file without the hash. 

In record mode, POST requests are stored with these hashes, so you can store various requests with different data 
Also in record mode a file with .request.json extension is created so you can see what was the original request for this 
specific call, but this file is not used, it's just a reference file.

== Data files == 

1) .data.raw
 - this is just a file which content will be served 

2) .headers.json
 - this file can contain any header you need to return
 - also you can simulate special status codes with "status" header as this is special key for sending various status codes

==== Example ===
mocks 
 `- public
    `- init.data.json
    `- init.headers.json
    `- hello.headers.json
    `- hello.headers.json


init.data.json 
-----------------------
{
    "init": "Hello World"
}

init.headers.json 
-----------------------
{
    "status": 200,
    "content-type": "application/json"
}


=== Test it ===
You can run the proxy server with the sample directory 

$ server.js ./sample 

$  curl http://localhost:3000/init
{
  "init": "Hello World"
}

$ curl http://localhost:3000/hello
<html>
  <head>
    <title>Hello</title>
  </head>
  <body>
    <h1>Hello</h1>
  </body>
</html>
