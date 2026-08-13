#!/usr/bin/env node

import { extractAsar } from './lib/asar-reader.mjs';

const [, , asarPath, outputDirectory] = process.argv;

if (!asarPath || !outputDirectory) {
  console.error('Usage: node scripts/extract-asar.mjs <app.asar> <output-directory>');
  process.exitCode = 2;
} else {
  try {
    const result = await extractAsar(asarPath, outputDirectory);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

