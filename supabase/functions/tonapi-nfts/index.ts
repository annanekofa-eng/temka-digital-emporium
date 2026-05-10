// Edge function: tonapi-nfts
// Fetches on-sale NFTs from TON via tonapi.io and normalizes them for the catalog UI.
// Public endpoint (verify_jwt = false) — read-only data.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface NormalizedNft {
  id: string;            // TON address
  number: string;        // short label (#1234 or @name)
  name: string;
  image: string;
  collection: string;
  collectionAddress: string;
  priceTon: number;      // numeric TON
  marketName: string | null;
  ownerAddress: string | null;
  attributes: Record<string, string>;
}

const ADDR_RE = /^(EQ|UQ|0:)[A-Za-z0-9_\-]{40,}$/;

function pickPreview(item: any): string {
  const previews: Array<{ resolution: string; url: string }> = item?.previews ?? [];
  // Prefer 500x500, fallback to last
  const p500 = previews.find((p) => p.resolution === '500x500');
  return (
    p500?.url ||
    previews[previews.length - 1]?.url ||
    item?.metadata?.image ||
    ''
  );
}

function normalize(item: any): NormalizedNft | null {
  const sale = item?.sale;
  if (!sale?.price?.value) return null;

  const decimals = Number(sale.price.decimals ?? 9);
  const raw = sale.price.value as string;
  // Convert big number string to number safely (NFT prices fit Number)
  const priceTon = Number(raw) / Math.pow(10, decimals);

  const meta = item?.metadata ?? {};
  const name: string = meta.name ?? item.address;
  const number = name.startsWith('@')
    ? name
    : typeof item.index === 'number' || typeof item.index === 'bigint'
    ? `#${String(item.index).slice(0, 8)}`
    : name;

  const attrsArr: Array<{ trait_type?: string; value?: string }> = meta.attributes ?? [];
  const attributes: Record<string, string> = {};
  for (const a of attrsArr) {
    if (a?.trait_type) attributes[a.trait_type] = String(a.value ?? '');
  }

  return {
    id: item.address,
    number,
    name,
    image: pickPreview(item),
    collection: item?.collection?.name ?? 'Unknown',
    collectionAddress: item?.collection?.address ?? '',
    priceTon,
    marketName: sale?.market?.name ?? null,
    ownerAddress: sale?.owner?.address ?? null,
    attributes,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const collection = url.searchParams.get('collection') ?? '';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '40', 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0);
    const sort = (url.searchParams.get('sort') ?? '').toLowerCase(); // price_asc | price_desc | ''

    if (!ADDR_RE.test(collection)) {
      return new Response(
        JSON.stringify({ error: 'invalid_collection', message: 'collection must be a TON address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Pull more than requested so client-side sort by price across the page is meaningful
    const fetchLimit = Math.min(limit + offset + 50, 1000);
    const apiUrl = `https://tonapi.io/v2/nfts/collections/${encodeURIComponent(
      collection
    )}/items?limit=${fetchLimit}&offset=0`;

    const tonRes = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'lovable-nft-catalog/1.0',
      },
    });

    if (!tonRes.ok) {
      const text = await tonRes.text();
      return new Response(
        JSON.stringify({ error: 'tonapi_error', status: tonRes.status, body: text.slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await tonRes.json();
    const rawItems: any[] = Array.isArray(data?.nft_items) ? data.nft_items : [];

    let items = rawItems
      .map(normalize)
      .filter((x): x is NormalizedNft => x !== null);

    if (sort === 'price_asc') items.sort((a, b) => a.priceTon - b.priceTon);
    else if (sort === 'price_desc') items.sort((a, b) => b.priceTon - a.priceTon);

    const total = items.length;
    const paged = items.slice(offset, offset + limit);

    return new Response(
      JSON.stringify({
        items: paged,
        total,
        limit,
        offset,
        collection,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          // Cache for 30s on the edge to soften tonapi rate limits
          'Cache-Control': 'public, max-age=30',
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return new Response(JSON.stringify({ error: 'internal', message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
