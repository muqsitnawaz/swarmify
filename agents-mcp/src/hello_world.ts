import { pathToFileURL } from 'url';
import { printHelloWorld } from './hello.js';

const invokedPath = process.argv[1];

if (invokedPath) {
  const invokedFileUrl = pathToFileURL(invokedPath).href;

  if (import.meta.url === invokedFileUrl) {
    printHelloWorld();
  }
}
