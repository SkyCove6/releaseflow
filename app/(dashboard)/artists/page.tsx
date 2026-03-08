"use client";

import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";

type ArtistListItem = {
  id: string;
  name?: string;
  genre?: string | null;
  bio?: string | null;
};

export default function ArtistsPage() {
  const artists = trpc.artists.list.useQuery();
  const artistRows: ArtistListItem[] = Array.isArray(artists.data)
    ? (artists.data as unknown as ArtistListItem[])
    : [];

  return (
    <>
      <Header title="Artists" />
      <main className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Artists</h2>
            <p className="text-muted-foreground">Manage roster and voice profile sources</p>
          </div>
          <Button asChild>
            <Link href="/artists/new">New Artist</Link>
          </Button>
        </div>

        {artistRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No artists yet</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Add an artist to unlock release planning and automation.
              </p>
              <Button asChild>
                <Link href="/artists/new">Create artist</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {artistRows.map((artist) => (
              <Card key={artist.id}>
                <CardHeader>
                  <CardTitle>{artist.name ?? "Untitled artist"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-sm text-muted-foreground">Genre: {artist.genre ?? "Not set"}</p>
                  <p className="text-sm text-muted-foreground">Bio: {artist.bio?.slice(0, 140) ?? "Not set"}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
