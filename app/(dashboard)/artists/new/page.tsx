"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";

export default function NewArtistPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [bio, setBio] = useState("");

  const createArtist = trpc.artists.create.useMutation({
    onSuccess: () => {
      toast.success("Artist created");
      router.push("/artists");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <Header title="New Artist" />
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Create Artist</h2>
              <p className="text-muted-foreground">Add artist profile details for lifecycle automation</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/artists">Back</Link>
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Artist Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Artist name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="genre">Genre</Label>
                <Input
                  id="genre"
                  value={genre}
                  onChange={(event) => setGenre(event.target.value)}
                  placeholder="Indie pop, hip-hop, house..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="Short artist bio"
                />
              </div>
              <Button
                onClick={() =>
                  createArtist.mutate({
                    name,
                    genre: genre || undefined,
                    bio: bio || undefined,
                  })
                }
                disabled={createArtist.isPending || !name.trim()}
              >
                Create Artist
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
