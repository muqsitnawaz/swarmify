import { pathToFileURL } from 'url';

export const HELLO_MESSAGE = 'hello world';

export function printHelloWorld(): void {
  console.log(HELLO_MESSAGE);
}

const invokedPath = process.argv[1];

if (invokedPath) {
  const invokedFileUrl = pathToFileURL(invokedPath).href;

  if (import.meta.url === invokedFileUrl) {
    printHelloWorld();
  }
}
