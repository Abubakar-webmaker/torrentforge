declare module "create-torrent" {
  interface CreateTorrentOptions {
    announceList?: string[][];
    announce?: string[];
    pieceLength?: number;
    private?: boolean;
    name?: string;
    created?: Date;
    createdBy?: string;
    comment?: string;
    urlList?: string[];
  }

  type CreateTorrentCallback = (err: Error | null, torrent?: Buffer) => void;

  function createTorrent(
    input: string | Buffer | string[],
    options?: CreateTorrentOptions,
    callback?: CreateTorrentCallback
  ): void;

  function createTorrent(
    input: string | Buffer | string[],
    callback?: CreateTorrentCallback
  ): void;

  export = createTorrent;
}
