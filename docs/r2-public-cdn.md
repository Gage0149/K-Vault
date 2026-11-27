# R2 Public CDN URLs

K-Vault can return public R2 object URLs directly instead of routing public file reads through Pages Functions.

## Configure

In Cloudflare Pages, open the K-Vault project and add this environment variable to the **Production** environment (and Preview only if you test preview deployments):

- Variable: `R2_PUBLIC_BASE_URL`
- Value: `https://img.wyfing.top` (replace with your R2 bucket's active custom domain)

Keep the existing R2 binding:

- Binding type: R2 bucket
- Variable name: `R2_BUCKET`
- Bucket: `k-vault-files`

Redeploy the Pages project after changing bindings or environment variables.

## Behavior

- When R2 is selected, new direct uploads, URL uploads, legacy chunked uploads, and native multipart uploads return the R2 custom-domain URL.
- Existing R2 records with the `r2:` key prefix are displayed and copied using the R2 custom domain when the setting is present.
- Telegram files continue to use the existing `/file/` route.
- If `R2_PUBLIC_BASE_URL` is not configured, uploads fall back to the existing `/file/r2:` route.
- The upload page switches to R2 as the default once after this upgrade. A later manual selection of Telegram is remembered in the browser.

## Cache policy

New R2 objects use:

```
Cache-Control: public, max-age=3600, s-maxage=86400
```

Browsers may cache for one hour; shared caches may cache for up to one day. Because there is no custom-domain purge integration in this change, a deleted object may remain visible from an edge cache until its cached response expires.

## Public-access warning

A public R2 custom domain exposes objects in that bucket to anyone who knows an object's URL. Direct R2 URLs bypass K-Vault's Pages file proxy, including its password, block/allow-list, and other per-file access checks. Do not put private or access-controlled files in a bucket exposed through this domain. Use Telegram or a separate private bucket/protected delivery path for those files.
