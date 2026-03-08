/**
 * Spotify Web API client for ReleaseFlow.
 *
 * Uses the Client Credentials flow — no user login required.
 * Tokens are cached in-memory for the process lifetime (60 min TTL).
 *
 * Required env vars:
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SpotifyAudioFeatures {
  id: string;
  danceability: number;   // 0–1
  energy: number;         // 0–1
  key: number;            // pitch class, -1 = unknown
  loudness: number;       // dB
  mode: number;           // 0 = minor, 1 = major
  speechiness: number;    // 0–1
  acousticness: number;   // 0–1
  instrumentalness: number;
  liveness: number;
  valence: number;        // 0–1  (sad → happy)
  tempo: number;          // BPM
  duration_ms: number;
  time_signature: number;
}

export interface SpotifyTrackSimple {
  id: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
  album: { name: string; release_date: string };
  popularity: number;
  external_urls: { spotify: string };
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  followers: { total: number };
  tracks: {
    total: number;
    items: Array<{
      added_at: string;
      track: SpotifyTrackSimple | null;
    }>;
  };
  owner: { display_name: string; id: string };
  external_urls: { spotify: string };
}

export interface SpotifySearchResult {
  playlists: {
    items: Array<{
      id: string;
      name: string;
      description: string;
      tracks: { total: number };
      owner: { display_name: string; id: string };
      external_urls: { spotify: string };
    }>;
  };
}

// ─── Token cache ────────────────────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`Spotify token error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return _tokenCache.token;
}

async function spotifyFetch<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify API error ${res.status} on ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API helpers ─────────────────────────────────────────────────────

/** Audio features for a single track. */
export async function getAudioFeatures(
  trackId: string
): Promise<SpotifyAudioFeatures> {
  return spotifyFetch<SpotifyAudioFeatures>(`/audio-features/${trackId}`);
}

/** Audio features for up to 100 tracks at once. */
export async function getBatchAudioFeatures(
  trackIds: string[]
): Promise<SpotifyAudioFeatures[]> {
  if (trackIds.length === 0) return [];
  const ids = trackIds.slice(0, 100).join(",");
  const data = await spotifyFetch<{ audio_features: SpotifyAudioFeatures[] }>(
    `/audio-features?ids=${ids}`
  );
  return data.audio_features.filter(Boolean);
}

/** Full playlist with up to 50 recent tracks. */
export async function getPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
  return spotifyFetch<SpotifyPlaylist>(
    `/playlists/${playlistId}?fields=id,name,description,followers,owner,external_urls,tracks(total,items(added_at,track(id,name,artists,album,popularity,external_urls)))`
  );
}

/**
 * Search for playlists by genre/mood query.
 * Returns up to `limit` results (max 50).
 */
export async function searchPlaylists(
  query: string,
  limit = 20
): Promise<SpotifySearchResult["playlists"]["items"]> {
  const q = encodeURIComponent(query);
  const data = await spotifyFetch<SpotifySearchResult>(
    `/search?q=${q}&type=playlist&limit=${Math.min(limit, 50)}`
  );
  return data.playlists.items.filter(Boolean);
}

/**
 * Artist's top tracks (for finding comparables on playlists).
 */
export async function getArtistTopTracks(
  artistId: string,
  market = "US"
): Promise<SpotifyTrackSimple[]> {
  const data = await spotifyFetch<{ tracks: SpotifyTrackSimple[] }>(
    `/artists/${artistId}/top-tracks?market=${market}`
  );
  return data.tracks;
}

// ─── Scoring helpers ────────────────────────────────────────────────────────

/**
 * Score how well a track's audio features match a playlist's average features.
 * Returns 0–100.
 */
export function scoreAudioFeatureMatch(
  track: Pick<SpotifyAudioFeatures, "energy" | "danceability" | "valence" | "tempo">,
  playlistAvg: Pick<SpotifyAudioFeatures, "energy" | "danceability" | "valence" | "tempo">
): number {
  const energyDiff = Math.abs(track.energy - playlistAvg.energy);
  const danceDiff = Math.abs(track.danceability - playlistAvg.danceability);
  const valenceDiff = Math.abs(track.valence - playlistAvg.valence);
  // Normalise BPM difference: 20 BPM = full mismatch
  const tempoDiff = Math.min(Math.abs(track.tempo - playlistAvg.tempo) / 20, 1);

  const totalDiff = (energyDiff + danceDiff + valenceDiff + tempoDiff) / 4;
  return Math.round((1 - totalDiff) * 100);
}

/** Compute the average audio features across a set of tracks. */
export function averageAudioFeatures(
  features: SpotifyAudioFeatures[]
): Pick<SpotifyAudioFeatures, "energy" | "danceability" | "valence" | "tempo"> {
  if (features.length === 0) {
    return { energy: 0.5, danceability: 0.5, valence: 0.5, tempo: 120 };
  }

  const sum = features.reduce(
    (acc, f) => ({
      energy: acc.energy + f.energy,
      danceability: acc.danceability + f.danceability,
      valence: acc.valence + f.valence,
      tempo: acc.tempo + f.tempo,
    }),
    { energy: 0, danceability: 0, valence: 0, tempo: 0 }
  );

  const n = features.length;
  return {
    energy: sum.energy / n,
    danceability: sum.danceability / n,
    valence: sum.valence / n,
    tempo: sum.tempo / n,
  };
}
