"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";

type ReleaseType = "single" | "ep" | "album";

type ArtistRow = {
  id: string;
  name?: string;
};

export default function DashboardReleaseWizardPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ReleaseType>("single");
  const [releaseDate, setReleaseDate] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [comparableArtists, setComparableArtists] = useState("");
  const [artworkDataUrl, setArtworkDataUrl] = useState<string | undefined>(undefined);
  const [artworkFilename, setArtworkFilename] = useState<string | undefined>(undefined);
  const [artistId, setArtistId] = useState("");
  const [createdReleaseId, setCreatedReleaseId] = useState<string | null>(null);

  const artistsQuery = trpc.artists.list.useQuery();
  const artists = (artistsQuery.data ?? []) as unknown as ArtistRow[];
  const defaultArtistId = useMemo(() => artists[0]?.id ?? "", [artists]);
  const selectedArtistId = artistId || defaultArtistId;

  const createRelease = trpc.release.create.useMutation({
    onSuccess: (result) => {
      setCreatedReleaseId(result.id as string);
      toast.success("Release created. Building your campaign...");
    },
    onError: (error) => toast.error(error.message),
  });

  const campaignQuery = trpc.campaign.byRelease.useQuery(
    { releaseId: createdReleaseId ?? "" },
    {
      enabled: Boolean(createdReleaseId),
      refetchInterval: (data) => (data?.campaign ? false : 2500),
    }
  );

  useEffect(() => {
    if (createdReleaseId && campaignQuery.data?.campaign?.id) {
      toast.success("Campaign generated");
      router.push(`/dashboard/releases/${createdReleaseId}/campaign`);
      router.refresh();
    }
  }, [campaignQuery.data?.campaign?.id, createdReleaseId, router]);

  async function handleArtworkUpload(file: File | null) {
    if (!file) {
      setArtworkDataUrl(undefined);
      setArtworkFilename(undefined);
      return;
    }
    setArtworkFilename(file.name);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read artwork file"));
      reader.readAsDataURL(file);
    });
    setArtworkDataUrl(dataUrl);
  }

  return (
    <>
      <Header title="Release Wizard" />
      <main className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Create release</h2>
            <p className="text-muted-foreground">From release setup to campaign generation in one flow.</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Release details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="release-title">Title</Label>
                <Input id="release-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="release-type">Type</Label>
                <select
                  id="release-type"
                  className="flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={type}
                  onChange={(event) => setType(event.target.value as ReleaseType)}
                >
                  <option value="single">Single</option>
                  <option value="ep">EP</option>
                  <option value="album">Album</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="release-date">Release date</Label>
                <Input id="release-date" type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="release-genre">Genre</Label>
                <Input id="release-genre" value={genre} onChange={(event) => setGenre(event.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="release-mood">Mood (comma-separated)</Label>
                <Input id="release-mood" value={mood} onChange={(event) => setMood(event.target.value)} />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="release-comparable">Comparable artists (comma-separated)</Label>
                <Input
                  id="release-comparable"
                  value={comparableArtists}
                  onChange={(event) => setComparableArtists(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="release-artist">Artist</Label>
                <select
                  id="release-artist"
                  className="flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={selectedArtistId}
                  onChange={(event) => setArtistId(event.target.value)}
                >
                  {artists.map((artist) => (
                    <option key={artist.id} value={artist.id}>
                      {artist.name ?? "Untitled artist"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="release-artwork">Artwork upload</Label>
                <Input
                  id="release-artwork"
                  type="file"
                  accept="image/*"
                  onChange={(event) => void handleArtworkUpload(event.target.files?.[0] ?? null)}
                />
              </div>

              <div className="sm:col-span-2">
                <Button
                  onClick={() =>
                    createRelease.mutate({
                      title,
                      type,
                      releaseDate: releaseDate || undefined,
                      genre,
                      mood: mood.split(",").map((value) => value.trim()).filter(Boolean),
                      comparableArtists: comparableArtists.split(",").map((value) => value.trim()).filter(Boolean),
                      artworkDataUrl,
                      artworkFilename,
                      artistId: selectedArtistId || undefined,
                    })
                  }
                  disabled={
                    createRelease.isPending ||
                    !title.trim() ||
                    !genre.trim() ||
                    !selectedArtistId
                  }
                >
                  Create release and build campaign
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={Boolean(createdReleaseId && !campaignQuery.data?.campaign?.id)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Building your campaign...</DialogTitle>
            <DialogDescription>
              We are generating rollout phases, milestones, and content tasks for this release.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded border p-3 text-sm text-muted-foreground">
            Release ID: {createdReleaseId}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

