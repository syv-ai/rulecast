<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Server-side request forgery (SSRF)

`ssrf` · anti-patterns, security

The server fetches a URL the client supplied (a webhook, an image to import, a link preview) without restricting where it may go, so a client can make it call internal services or the cloud metadata endpoint on their behalf.

*Names:* First described by Deral Heiland at ShmooCon 2008 ("Web Portals: Gateway To Information Or A Hole In Our Perimeter Defenses"), as tunnelling requests through a portal to systems behind the firewall. The SSRF name spread from Alexander Polyakov and Dmitry Chastukhin's (ERPScan) Black Hat USA 2012 talk "SSRF vs. Business-critical Applications". Orange Tsai's 2017 "A New Era of SSRF" showed URL-parser inconsistencies. MITRE's CWE-918. A10:2021 in the OWASP Top 10, folded into A01:2025 Broken Access Control, and API7:2023 in the API Security Top 10.

*Matters most for:* web-api, serverless, platforms, distributed

## But

Server-to-server calls to fixed, configured URLs are not SSRF. Tools that run on the user's own machine (a CLI, a desktop app) fetching a URL the same user typed have no privilege boundary to cross. OWASP notes SSRF can't always be removed entirely where users must supply arbitrary URLs, so the defence is layered and network-level isolation does most of the work.

## Quality axes

- **delivery** +: Fetching the supplied URL is one line; resolving, filtering and isolating egress is real work.
- **security** −: A client can make the server reach internal services or the cloud metadata endpoint and read what comes back.

## Why people fall into it

- Webhooks, link previews, imports and integrations are real features that need outbound fetches.
- Fetching a URL is one line, and the internal network feels private.
- Block-lists seem enough until someone uses a decimal IP, an IPv6 form, a redirect or a DNS name that resolves to 10.0.0.1.
- Cloud metadata endpoints aren't visible to the developer writing the feature.

## How it shows

- An HTTP client call whose URL comes from the request (a webhook url, avatar_url, feed_url, callback, import from link).
- URL checks done with string prefix matching or a block-list of hostnames such as localhost.
- The HTTP client follows redirects after the URL was checked.
- The host is checked, then resolved again at connect time (DNS rebinding).
- The fetched response body or error is returned to the client.
- PDF or image renderers, XML parsers with external entities, or headless browsers fed user URLs.

## Overcorrecting looks like

- Blocking all outbound requests, including fixed integrations to known hosts that carry no risk.
- Writing an elaborate URL validator in the app when an egress proxy or network policy would enforce it more reliably.

## What to do

Where the destinations are known, allow-list them and build the URL yourself from a fixed scheme, host and path. Where they aren't (webhooks), resolve the host, reject private, loopback, link-local and metadata addresses, connect to the checked address, and disable redirects. Run fetches from an isolated network segment or egress proxy that can't reach internal services, require IMDSv2 on AWS, and don't return raw upstream responses.

## Example

Before:

```
route POST "/feeds"
fn subscribe(body: FeedRequest, user: User) -> Feed:
    response = http.get(body.feed_url)      # follows redirects
    feed = parse_feed(response.text)
    return feeds.save(user.id, body.feed_url, feed.title)
```

After:

```
route POST "/feeds"
fn subscribe(body: FeedRequest, user: User) -> Feed:
    url = parse_url(body.feed_url)
    if url.scheme not in ["https"]:
        return error(400, "feed must use https")
    address = resolve_public_address(url.host)   # rejects private, loopback, metadata
    response = egress.get(url, connect_to=address, follow_redirects=False)
    feed = parse_feed(response.text)
    return feeds.save(user.id, body.feed_url, feed.title)
```

The fetch can only reach a public address that was checked at connect time, without redirects, through an egress client that has no route to internal services.

## One-file tell

Written for python, typescript, java, csharp, go and rust web handlers. An outbound HTTP call (requests or httpx get or post, fetch, axios, HttpClient send or GetAsync, http.Get, reqwest get) whose URL argument is read from the incoming request in the same function (a query parameter, form field or body field) with no allow-list lookup between them. Most real cases pass the URL through a stored record and won't show in one file.

## By language

**python:** requests follows redirects by default, httpx does not (follow_redirects=False). The ipaddress module's is_global helps reject private targets; OWASP warns urllib.parse can read a different host from crafted URLs than the HTTP client does.

**typescript:** fetch follows redirects unless redirect is set to "manual" or "error". Checking the host string doesn't stop DNS rebinding; a custom agent or lookup function that checks the resolved address does.

**java:** java.net.http.HttpClient doesn't follow redirects by default (Redirect.NEVER); many other clients do. Apache Commons Validator's InetAddressValidator resists encoded-IP tricks.

**csharp:** HttpClientHandler follows redirects by default (AllowAutoRedirect). SocketsHttpHandler's ConnectCallback can check the resolved address before connecting; OWASP notes IPAddress.TryParse accepts hex and octal forms.

**go:** http.Client follows up to ten redirects unless CheckRedirect says otherwise. A net.Dialer Control function that rejects private addresses checks the address actually dialled, which defeats rebinding.

**rust:** reqwest follows redirects by default; use redirect::Policy::none() and check the resolved address with a custom resolver.

## Related

[Secure by default](secure-by-default.md) · [Least privilege](least-privilege.md) · [Defense in depth](defense-in-depth.md) · [Validate at the boundary](validate-at-the-boundary.md)

## Sources

- [OWASP API Security Top 10 2023, API7:2023 Server Side Request Forgery (CC BY-SA 4.0)](https://api-security.owasp.org/editions/2023/en/0xa7-server-side-request-forgery/) (read)
- [OWASP Cheat Sheet Series, Server Side Request Forgery Prevention (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A01:2025 Broken Access Control, CWE-918 (CC BY 3.0)](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/) (read)
- Polyakov et al. (ERPScan), SSRF vs. Business-critical Applications, Black Hat USA 2012 (recalled)
- Orange Tsai, A New Era of SSRF, Black Hat USA 2017 (recalled)
