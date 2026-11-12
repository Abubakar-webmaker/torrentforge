declare module "webtorrent" {
  export interface Torrent {
    infoHash: string;
    [key: string]: any;
  }

  export interface WebTorrentOptions {
    announceList?: string[][];
    [key: string]: any;
  }

  export interface SeedOptions {
    announceList?: string[][];
    [key: string]: any;
  }

  class WebTorrent {
    constructor(options?: WebTorrentOptions);
    seed(
      input: string | Buffer,
      options: SeedOptions,
      callback: (torrent: Torrent) => void
    ): void;
    seed(input: string | Buffer, callback: (torrent: Torrent) => void): void;
    destroy(callback?: (err?: Error) => void): void;
  }

  export default WebTorrent;
}
