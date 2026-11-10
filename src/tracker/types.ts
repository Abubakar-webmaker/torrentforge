export interface TrackerPeer {
  ip: string;
  port: number;
}

export interface TrackerAnnounceParams {
  infoHash: Buffer;
  peerId: Buffer;
  port: number;
  uploaded: number;
  downloaded: number;
  left: number;
  event?: "started" | "stopped" | "completed";
}

export interface TrackerResponse {
  interval: number;       // seconds — kitni der baad dobara announce karna hai
  peers: TrackerPeer[];
  seeders?: number;
  leechers?: number;
}