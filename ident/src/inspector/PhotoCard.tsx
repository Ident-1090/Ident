import { useEffect, useState } from "react";

interface Photo {
  thumbnail_large: {
    src: string;
    size: { width: number; height: number };
  };
  photographer: string;
  link: string;
}

interface PhotoData {
  photo: Photo;
}

// Module-scoped cache. null = fetched, API returned no photos.
// undefined (absent) = not yet fetched. Only 200/404/empty bodies populate the
// cache; transient (5xx / network) failures are left absent so a later mount
// can retry.
const cache = new Map<string, PhotoData | null>();

interface Props {
  hex: string;
  reg?: string;
  type?: string;
}

export function PhotoCard({ hex, reg, type }: Props) {
  const [data, setData] = useState<PhotoData | null | undefined>(() =>
    cache.get(hex.toUpperCase()),
  );

  useEffect(() => {
    const key = hex.toUpperCase();
    if (cache.has(key)) {
      setData(cache.get(key));
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams();
        if (reg) params.set("reg", reg);
        if (type) params.set("icaoType", type);
        const qs = params.toString();
        const url =
          `https://api.planespotters.net/pub/photos/hex/${key}` +
          (qs ? `?${qs}` : "");
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          if (res.status === 404) cache.set(key, null);
          return;
        }
        const json = (await res.json()) as {
          photos?: Array<Photo>;
        };
        const first = json.photos?.[0];
        const value = first ? { photo: first } : null;
        cache.set(key, value);
        setData(value);
      } catch {
        // Network / abort / parse errors: leave cache unset so a later mount retries.
      }
    })();

    return () => controller.abort();
  }, [hex, reg, type]);

  if (!data) return null;
  const { photo } = data;
  return (
    <div className="relative h-[126px] bg-paper-2 border-b border-(--color-line) overflow-hidden shrink-0">
      <img
        src={photo.thumbnail_large.src}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover block"
      />
      <div
        className="absolute bottom-1 right-2 font-mono text-[9px] text-[#cfd3d8] bg-black/65 px-1.25 py-px rounded-xs whitespace-nowrap overflow-hidden text-ellipsis"
        style={{ maxWidth: "calc(100% - 16px)" }}
      >
        ©{" "}
        {photo.link ? (
          <a
            href={photo.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-inherit hover:underline"
          >
            {photo.photographer}
          </a>
        ) : (
          photo.photographer
        )}
      </div>
    </div>
  );
}

// Test-only hook. Not exported from a public index; importing this from non-test
// code is a smell but harmless.
export function __clearPhotoCache() {
  cache.clear();
}
