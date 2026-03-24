type ChromeListener<T extends (...args: any[]) => any> = {
  addListener(callback: T): void;
};

declare namespace chrome {
  namespace runtime {
    interface Port {
      name: string;
      sender?: {
        id?: string;
      };
      disconnect(): void;
      postMessage(message: any): void;
      onMessage: ChromeListener<(message: any) => void>;
      onDisconnect: ChromeListener<() => void>;
    }

    function connect(connectInfo: { name: string }): Port;
    function sendMessage(message: any): Promise<any>;
    function openOptionsPage(): void;
    function getURL(path: string): string;

    const id: string;
    const onMessage: ChromeListener<
      (
        message: any,
        sender: { id?: string },
        sendResponse: (response: any) => void,
      ) => boolean | void
    >;
    const onConnect: ChromeListener<(port: Port) => void>;
    const onInstalled: ChromeListener<() => void>;
  }

  namespace storage {
    interface StorageArea {
      get(
        keys?: string | string[] | Record<string, any>,
        callback?: (result: any) => void,
      ): Promise<any> | void;
      set(items: Record<string, any>, callback?: () => void): Promise<void> | void;
      remove(keys: string | string[]): Promise<void> | void;
    }

    const sync: StorageArea;
    const local: StorageArea;
    const session: StorageArea;
  }

  namespace contextMenus {
    function create(props: Record<string, any>): void;
    const onClicked: ChromeListener<(info: any) => void>;
  }

  namespace commands {
    const onCommand: ChromeListener<(command: string) => void>;
  }

  namespace action {
    function openPopup(): Promise<void>;
  }

  namespace tabs {
    function create(createProperties: { url: string }): Promise<any>;
    function query(queryInfo: Record<string, any>): Promise<any[]>;
  }

  namespace scripting {
    function executeScript<T>(details: Record<string, any>): Promise<Array<{ result: T }>>;
  }
}

declare const chrome: typeof globalThis.chrome;
