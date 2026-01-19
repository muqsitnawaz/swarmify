import { pathToFileURL } from 'url';

export function printHelloWorld(): void {
  console.log('hello world');
}

const invokedPath = process.argv[1];

if (invokedPath) {
  const invokedFileUrl = pathToFileURL(invokedPath).href;

  if (import.meta.url === invokedFileUrl) {
    printHelloWorld();
  }
}
