#!/usr/bin/env node
const crypto = require('crypto')
const fs = require("fs");
const stdinBuffer = fs.readFileSync(0)

function hashCode(str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

console.log(hashCode(stdinBuffer.toString()))
