// Edge function: portals-gifts
// Live catalog of Telegram Gifts via Portals marketplace public API.
// Actions:
//   - action=collections      → list gift collections
//   - action=filters&collection=ID → unique model/backdrop/symbol values (with counts)
//   - action=list (default)   → list NFTs for sale (filterable, sortable, paginated)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PORTALS_BASE = 'https://portal-market.com/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

interface NormalizedNft {
  id: string;
  name: string;
  number: string;
  image: string;
  animationUrl: string | null;
  priceTon: number;
  collectionId: string;
  attributes: { type: string; value: string; rarity?: number }[];
}

interface NormalizedCollection {
  id: string;
  name: string;
  shortName: string;
  image: string;
  floorTon: number | null;
  supply: number | null;
  listedCount: number | null;
  dayVolumeTon: number | null;
}

function normalizeNft(item: any): NormalizedNft | null {
  if (!item?.id || !item?.price) return null;
  return {
    id: String(item.id),
    name: item.name ?? 'Unknown',
    number:
      item.external_collection_number != null
        ? `#${item.external_collection_number}`
        : (item.tg_id ?? ''),
    image: item.photo_url ?? '',
    animationUrl: item.animation_url ?? null,
    priceTon: Number(item.price),
    collectionId: item.collection_id ?? '',
    attributes: Array.isArray(item.attributes)
      ? item.attributes.map((a: any) => ({
          type: a.type,
          value: a.value,
          rarity: a.rarity_per_mille,
        }))
      : [],
  };
}

function normalizeCollection(c: any): NormalizedCollection | null {
  if (!c?.id || !c?.name) return null;
  return {
    id: String(c.id),
    name: c.name,
    shortName: c.short_name ?? '',
    image: c.photo_url ?? '',
    floorTon: c.floor_price != null ? Number(c.floor_price) : null,
    supply: c.supply ?? null,
    listedCount: c.listed_count ?? null,
    dayVolumeTon: c.day_volume != null ? Number(c.day_volume) : null,
  };
}

async function fetchCollections(): Promise<NormalizedCollection[]> {
  const r = await fetch(`${PORTALS_BASE}/collections?limit=200`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!r.ok) throw new Error(`portals collections ${r.status}`);
  const data = await r.json();
  const arr: any[] = data?.collections ?? [];
  return arr
    .map(normalizeCollection)
    .filter((c): c is NormalizedCollection => !!c)
    .sort((a, b) => (b.dayVolumeTon ?? 0) - (a.dayVolumeTon ?? 0));
}

async function fetchNfts(params: {
  collectionId?: string;
  models?: string;
  backdrops?: string;
  symbols?: string;
  minPrice?: string;
  maxPrice?: string;
  sortBy: string;
  limit: number;
  offset: number;
}): Promise<NormalizedNft[]> {
  const qs = new URLSearchParams({
    status: 'listed',
    limit: String(params.limit),
    offset: String(params.offset),
    sort_by: params.sortBy,
  });
  if (params.collectionId) qs.set('collection_ids', params.collectionId);
  if (params.models) qs.set('filter_by_models', params.models);
  if (params.backdrops) qs.set('filter_by_backdrops', params.backdrops);
  if (params.symbols) qs.set('filter_by_symbols', params.symbols);
  if (params.minPrice) qs.set('min_price', params.minPrice);
  if (params.maxPrice) qs.set('max_price', params.maxPrice);

  const r = await fetch(`${PORTALS_BASE}/nfts/search?${qs.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`portals search ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  const arr: any[] = data?.results ?? [];
  return arr.map(normalizeNft).filter((x): x is NormalizedNft => !!x);
}

async function fetchFilters(collectionId: string) {
  // Sample listed items to derive available attribute values
  const items = await fetchNfts({
    collectionId,
    sortBy: 'price asc',
    limit: 100,
    offset: 0,
  });
  const buckets: Record<'model' | 'backdrop' | 'symbol', Map<string, number>> = {
    model: new Map(),
    backdrop: new Map(),
    symbol: new Map(),
  };
  for (const it of items) {
    for (const a of it.attributes) {
      const k = a.type as keyof typeof buckets;
      if (!buckets[k]) continue;
      buckets[k].set(a.value, (buckets[k].get(a.value) ?? 0) + 1);
    }
  }
  const toArr = (m: Map<string, number>) =>
    Array.from(m.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  return {
    models: toArr(buckets.model),
    backdrops: toArr(buckets.backdrop),
    symbols: toArr(buckets.symbol),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? 'list';

    if (action === 'collections') {
      const collections = await fetchCollections();
      return new Response(JSON.stringify({ collections }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    if (action === 'detail') {
      const id = url.searchParams.get('id') ?? '';
      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Try direct endpoint, fall back to search by id
      let raw: any = null;
      try {
        const r = await fetch(`${PORTALS_BASE}/nfts/${encodeURIComponent(id)}`, {
          headers: { Accept: 'application/json', 'User-Agent': UA },
        });
        if (r.ok) raw = await r.json();
      } catch (_) { /* ignore */ }
      if (!raw) {
        const r2 = await fetch(
          `${PORTALS_BASE}/nfts/search?ids=${encodeURIComponent(id)}&limit=1&offset=0`,
          { headers: { Accept: 'application/json', 'User-Agent': UA } },
        );
        if (r2.ok) {
          const j = await r2.json();
          raw = j?.results?.[0] ?? null;
        }
      }
      if (!raw) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ normalized: normalizeNft(raw), raw }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=15',
          },
        },
      );
    }

    if (action === 'filters') {
      const collectionId = url.searchParams.get('collection') ?? '';
      if (!collectionId) {
        return new Response(JSON.stringify({ models: [], backdrops: [], symbols: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const filters = await fetchFilters(collectionId);
      return new Response(JSON.stringify(filters), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=120',
        },
      });
    }

    const collectionId = url.searchParams.get('collection') ?? '';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '40', 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0);
    const sort = (url.searchParams.get('sort') ?? 'price_asc').toLowerCase();
    const models = url.searchParams.get('models') ?? '';
    const backdrops = url.searchParams.get('backdrops') ?? '';
    const symbols = url.searchParams.get('symbols') ?? '';
    const minPrice = url.searchParams.get('min_price') ?? '';
    const maxPrice = url.searchParams.get('max_price') ?? '';

    const sortMap: Record<string, string> = {
      price_asc: 'price asc',
      price_desc: 'price desc',
      newest: 'listed_at desc',
      rarity: 'model_rarity asc',
    };
    const sortBy = sortMap[sort] ?? 'price asc';

    const items = await fetchNfts({
      collectionId,
      models,
      backdrops,
      symbols,
      minPrice,
      maxPrice,
      sortBy,
      limit,
      offset,
    });

    return new Response(
      JSON.stringify({ items, limit, offset, collectionId }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=15',
        },
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return new Response(JSON.stringify({ error: 'internal', message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
