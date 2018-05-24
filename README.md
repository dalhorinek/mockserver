Mock server to serve mock data files, proxy to remote servers and record responses.

It searches for files by requested path, it looks for file .data.raw and .headers.json 
The content of the .data.raw file is returned and if .headers.json file is preseent, these headers are used instead of default headers. 

# Installation

```
$ npm install 
```

# Usage

## Help 
```
$ server --help 
server.js [options] mock_directory

 options:
  --proxy proxy_target - starts is fallback mode - mock first and fallbacks to proxy
  --proxy-full - full mode - everything is proxied to proxy target
  --proxy-first - first ask proxy target, on fail try to return data from mocks
  --proxy-timeout - how long to wait umtil timeout is thrown on proxy request (default is 10s)
  --record - save proxied requests to mocks
  --port port_number - local port for mock server
```

## Modes
The server has 4 different modes. 

### FULL_MOCK 
  - only .data.raw files from given directory are served 

  ```
  $ server data
  ```

### PROXY_FIRST 
  - when you specify a proxy server, it tries to proxy the request to the server, if it's successful, it returns the response from proxy
  - when there is a timeout on the proxy server, mock data are returned
  - when there are 3 or more failed attempts on proxy server, it automatically switches to FULL_MOCK mode 

  ```
  $ server data --proxy https://some.proxy.server --proxy-first
  ```

### MOCK_FIRST 
  - it tries to read data from .data.raw files and if the data is not present, it proxies the request to the proxy server

  ```
  $ server data --proxy https://some.proxy.server
  ```

### FULL_PROXY 
  - it proxies all requests to the proxy server

  ```
  $ server data --proxy https://some.proxy.server --proxy-full 
  ``` 

## Recording
If you use mode PROXY_FIRST, MOCK_FIRST or FULL_PROXY, you can specify --record option and this will 
record responses from the proxy server so you can use real data as mocks whne proxy is not available.
It just creates .data.raw and .header.json files 

  ``` 
  $ server data --proxy https://some.proxy.server --proxy-first --record
  ```

## Public and private context
If Authorization header is present, data are stored into /private folder, otherwise in /public folder. 
This enables to mock different requests on same endpoint with and without authorization

## Definition file and Func file 
A definition file is a file that matches a request path and has .json extension. 
/some/path => /public/some/path.json 

If this file is present, it's content is read. Currently it can contain only a "type" attribute. This attribute can contain 
a value of "data" or "func". The data value is default and when this file is not present, the type data is used. 

For the func type, then the mock server will look for a .func.js file, if this file is present, then it's loaded and it should contain a function.
A function that receives a request and returns data content. 
(See date endpoint example in examples directory)

Example:
```
    some/endpoint.func.js 
    -----------------------

    function currentDate(request) {
      return (new Date()).toString()
    }
```

Now when you call /some/endpoint it will always return current date. 
If .func.js and .data.raw are both present, .func.js is picked as first option

### Post data specific response
For every POST request a numeric hash is calculated and mock server looks first for a file with this
hash in it's name, like some/endpoint.12345.data.raw or some/endpoint.12345.headers.json, if no such file is present,
it will try to load data/headers file without the hash. 

In record mode, POST requests are stored with these hashes, so you can store various requests with different data 
Also in record mode a file with .request.json extension is created so you can see what was the original request for this 
specific call, but this file is not used, it's just a reference file.

## Mock files

1) .data.raw
 - this is just a file which content will be served 

2) .headers.json
 - this file can contain any header you need to return
 - also you can simulate special status codes with "status" header as this is special key for sending various status codes

## Example
```
sample
 `- public
    `- init.data.raw
    `- init.headers.json
    `- hello.data.raw
    `- hello.headers.json
    `- fail.headers.json
    `- fail.data.raw


init.data.raw 
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
```

You can run the proxy server with the sample directory 

```
$ server.js ./sample 
```

Test successful init request with json data

```
$  curl http://localhost:3000/init
{
  "init": "Hello World"
}
```

Test some HTML response
```
$ curl http://localhost:3000/hello
<html>
  <head>
    <title>Hello</title>
  </head>
  <body>
    <h1>Hello</h1>
  </body>
</html>
```

Test to respond with 500 error
```
$ curl http://localhost:3000/fail --head
HTTP/1.1 500 Internal Server Error
X-Powered-By: Express
content-type: text/html
Date: Thu, 24 May 2018 18:53:26 GMT
Connection: keep-alive
```

Test func.js file with current date response
```
$ curl http://localhost:3000/date
Thu May 24 2018 21:08:35 GMT+0200 (CEST)
```
