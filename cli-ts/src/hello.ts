import { pathToFileURL } from 'url';

export const HELLO_MESSAGE = 'Hello, world!';

export function printHelloWorld(): void {
  console.log(HELLO_MESSAGE);
}

const invokedFileUrl = pathToFileURL(process.argv[1] ?? '').href;

if (import.meta.url === invokedFileUrl) {
  printHelloWorld();
}
