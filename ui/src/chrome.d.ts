/* eslint-disable @typescript-eslint/no-explicit-any */
// Next.js build runs in Node; this just satisfies TS.
// In extension runtime, `chrome` is provided by the browser.

declare namespace chrome {
  namespace runtime {
    interface Port {
      name: string;
      disconnect(): void;
      postMessage(message: any): void;
      onMessage: { addListener(cb: (message: any) => void): void };
    }

    function connect(connectInfo: { name: string }): Port;
    function sendMessage(message: any): Promise<any>;
  }

  namespace storage {
    const session: any;
    const local: any;
    const sync: any;
  }
}
