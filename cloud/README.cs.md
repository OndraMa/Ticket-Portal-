# TicketPortal – OneDrive, bez Turnstile

Pracovní cloudová verze je v cloud.html. Původní index.html se nemění.
Kolegové zadávají pouze společné heslo; nevybírají složku a nepřihlašují se k Microsoftu.
Sériová čísla zůstávají jako multiselect včetně editace a kopírování záznamu pro každý robot.

## Co je připravené a co chybí

Zdroj frontendu, Cloudflare Workeru, testů a konfigurace je připravený.
Bez nasazení Workeru a jednorázového souhlasu vlastníka OneDrivu nefunguje cloudové ukládání.
Worker je cloudový server, nikoli Turnstile. Turnstile, CAPTCHA ani její klíče se nepoužívají.
Workers a SQLite Durable Objects podporují tarif Free. Bezplatné limity jsou konečné;
při překročení se požadavky zastaví, pokud účet zůstane na Free.

## Připojení – vše může běžet v cloudu

1. V Microsoft Entra zaregistruj aplikaci nazvanou **TicketPortal**.
   Podporované účty: osobní účty Microsoft (případně organizace a osobní účty).
   Pokud tvůj účet neumožňuje registraci aplikace, nejprve je nutné vyřešit přístup
   do Entra; samotný odkaz sdílené složky tuto registraci nenahradí.
2. Microsoft Graph: pouze **Delegated Files.ReadWrite.AppFolder**.
   Nepřidávej Files.ReadWrite, Files.ReadWrite.All ani jiné oprávnění k celému disku.
   Odeber přednastavené User.Read, protože ho portál nevyužívá.
3. Zkopíruj Application (client) ID. Vytvoř klientský secret a jeho **hodnotu**
   vlož pouze do Cloudflare jako MS_CLIENT_SECRET. Poznamenej si datum expirace.
4. V Cloudflare zvol **Workers & Pages → Create → Import a repository**.
   Vyber tento repozitář a pracovní větev, root directory cloud/backend,
   deploy command npm run deploy. Worker potřebuje SQLite Durable Object
   PORTAL; vytvoří ho migrace ve wrangler.toml.
   Nepoužívej statické Pages pro backend.
5. Zjisti adresu Workeru (např. https://ticketportal-onedrive.TVUJ-UCET.workers.dev).
   Do cloud/backend/wrangler.toml nastav PUBLIC_URL na tuto adresu,
   MS_CLIENT_ID na client ID a PORTAL_ORIGIN na https://ondrama.github.io.
   Žádný secret nesmí být v tomto souboru, repozitáři ani frontendu.
6. V Entra přidej redirect URI typu **Web**:
   https://ticketportal-onedrive.TVUJ-UCET.workers.dev/oauth/callback.
   Nevytvářej SPA redirect a nepovoluj implicit flow.
7. V Cloudflare Settings → Variables and Secrets nastav šifrované secrets:
   MS_CLIENT_SECRET, PORTAL_PASSWORD_HASH, SESSION_SECRET,
   TOKEN_ENCRYPTION_KEY a ADMIN_SETUP_KEY.
   SESSION_SECRET a ADMIN_SETUP_KEY jsou různé náhodné klíče alespoň 32 bajtů.
   TOKEN_ENCRYPTION_KEY musí být přesně 32 náhodných bajtů v base64.
   PORTAL_PASSWORD_HASH je base64Salt:base64Hash, PBKDF2 SHA-256,
   100000 iterací a 32 bajtů. Soukromý pomocník secrets.mjs tyto hodnoty vytvoří;
   lze ho spustit v soukromém Cloud Shellu, není součástí běžného provozu.
   Výstupy ani heslo nevkládej do chatu, Actions logů nebo commitu.
8. Otevři URL Workeru /admin. Zadej ADMIN_SETUP_KEY a přihlas **svůj**
   osobní Microsoft účet. Odsouhlas jen přístup ke složce aplikace.
   Microsoft automaticky vytvoří v OneDrivu **Apps / TicketPortal**
   (v českém rozhraní může být Apps zobrazeno jako Aplikace).
9. **Složku veřejně nesdílej a neposílej odkaz „kdokoli s odkazem“.**
   Do Apps / TicketPortal zkopíruj **obsah** stávající složky Data:
   servisni.json, dily.json a všechny složky SERV_* s přílohami.
   Nevkládej tam další obalovou složku Data. Původní Data si ponech jako zálohu.
   Kopírování dokonči před prvním použitím nové verze.
10. Do cloud/config.js nastav pouze veřejnou URL Workeru.
    Po publikování této větve na GitHub Pages otevři
    https://ondrama.github.io/Ticket-Portal-/cloud.html.
    Přihlas se společným heslem, ověř počet záznamů, přílohy, nový záznam,
    editaci sériových čísel a načtení z druhého prohlížeče.
    Původní stránka /index.html zůstává dostupná.

Pro další dokončení můžeš poskytnout **client ID a veřejnou URL Workeru**.
Heslo Microsoftu, klientský secret, obnovovací token, instalační klíč a heslo portálu
se nikdy neposílají do chatu; zadávají se pouze v příslušné službě.

## Ukládání a ochrana

- Microsoft scope omezuje přístup aplikace na její složku; ostatní OneDrive nevidí.
- Obnovovací token je šifrovaný AES-GCM v Durable Object. Krátkodobý Microsoft
  token zůstává na serveru; kolega ho nedostává.
- Společné heslo se ověřuje na serveru pomocí PBKDF2. Relace vydrží 8 hodin,
  je podepsaná a uložená jen v sessionStorage příslušné záložky.
  Změna heslového hashe nebo SESSION_SECRET zneplatní stávající relace.
- Bez CAPTCHA: 5 přihlašovacích pokusů na IP za 15 minut, globálně 100;
  autentizované API 1200 požadavků na IP za hodinu.
  Omezení pokusů není záruka proti distribuovanému zahlcení.
- Bot nemusí znát adresu stránky: ochranu zajišťuje server, ne neindexování.
- Názvy cest jsou kontrolované, server nepřijímá libovolné Microsoft URL ani ID.
- Záznamy a díly jsou ukládány atomicky jako jeden portal-state.json v OneDrivu.
  Při prvním načtení se použijí původní servisni.json a dily.json.
  Od prvního uložení je zdrojem pravdy portal-state.json; původní dva soubory
  se nepřepisují. Export v portálu vytváří aktuální servisni.json a dily.json.
- Kontrola verze odmítne přepsat novější data kolegy. Po konfliktu obnov stránku
  a změnu zopakuj. Přílohy vytvořené před konfliktem mohou zůstat jako sirotci;
  záznamy kolegy se nepřepíšou. Přílohy i soubory mazaných záznamů se ponechávají
  pro obnovu, takže je případně čistí vlastník přímo v OneDrivu.
- Každá jednotlivá příloha může mít nejvýše 25 MB. Celkových 225 MB lze přenést
  po souborech; není nutné je nahrávat jako jeden archiv.
- Nahrávání nových příloh přidává UUID do názvu, aby nepřepisovaly staré soubory.
- Při odvolání Microsoft souhlasu, expiraci secretu nebo obnovovacího tokenu
  musí vlastník znovu připojit OneDrive přes /admin; kolegové Microsoft nepotřebují.
- Zálohy OneDrivu jsou stále důležité. Autor portálu má přístup k záznamům stejně
  jako každý, kdo zná sdílené heslo; rozdělení rolí tato verze nezavádí.

## Ověření

node --test tests/serial-edit.test.cjs tests/cloud.test.mjs
npm --prefix cloud/backend install
npm --prefix cloud/backend exec -- wrangler deploy --dry-run

Živé přihlášení a Microsoft Graph se ověřují až s vlastníkem a skutečnou konfigurací.
Testy používají simulovaný OneDrive, aby se nedotýkaly skutečných souborů.

Dokumentace:
- https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://developers.cloudflare.com/durable-objects/platform/pricing/
