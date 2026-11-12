declare module "bittorrent-tracker" {
  import { EventEmitter } from "events";

  interface ServerOptions {
    http?: boolean;
    https?: boolean;
    udp?: boolean;
    ws?: boolean;
    wsSecret?: string;
    stats?: boolean;
  }

  class Server extends EventEmitter {
    constructor(options?: ServerOptions);
    listen(port: number, host?: string, callback?: () => void): void;
    close(callback?: () => void): void;
  }

  export { Server };
}
