# TicketPortal: podrobný návod pro bezplatný Cloudflare a soukromý OneDrive

Ověřeno 3. 10. 2026. Návod se vztahuje na pracovní větev
work/onedrive-cloud-no-turnstile v repozitáři OndraMa/Ticket-Portal-.

Portál a server jsou připravené jako zdrojový kód. Skutečné připojení tvého OneDrivu
ještě neproběhlo. Původní index.html zůstává funkční.

## 1. Cena a bezplatné limity

Pro připravený server lze použít **Cloudflare Workers Free za 0 USD**.
Nepřepínej účet na Workers Paid. Vlastní doména není potřeba; dostaneš adresu
s koncovkou workers.dev.

| Součást | Bezplatný limit | Co v portálu dělá |
|---|---:|---|
| Workers | 100 000 požadavků denně | Přijímá požadavky portálu |
| SQLite Durable Objects | 100 000 požadavků denně | Hlídá přihlášení a souběžné operace |
| SQLite Durable Objects | 5 GB uložených dat celkem | Uchovává šifrovaný token a drobné provozní údaje |
| Workers Builds | 3 000 minut sestavování měsíčně | Nasazuje změny z GitHubu |

Vedle počtu požadavků platí také limity CPU, doby běhu a čtení/zápisu.
Limit požadavků není počet uživatelů: otevření několika příloh znamená více požadavků.
Na Free se při vyčerpání limitu operace odmítnou; pro pokračování není třeba
automaticky přijímat placený tarif. Workers Paid je samostatný placený plán,
který pro tento postup nezvolíme.

Tvoje nynější přílohy 225 MB zůstávají v OneDrivu a spotřebovávají jeho kapacitu,
nikoli úložiště Durable Object. Připravená aplikace omezuje jednotlivou nově
nahrávanou přílohu na 25 MB. Celá složka může být větší.

Zdroje: [Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Builds](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

## 2. Nejdříve ověř Microsoft – ještě před nastavováním Cloudflare

Přístup k OneDrivu vyžaduje registraci aplikace v Microsoft Entra.
Samotné zaplacené předplatné OneDrive 100 GB nezaručuje, že máš možnost aplikaci registrovat.

1. Otevři [Microsoft Entra](https://entra.microsoft.com/).
2. Přihlas se účtem, který má možnost spravovat registrace aplikací.
3. Vyhledej **Entra ID → App registrations / Registrace aplikací**.
4. Ověř, že je dostupné tlačítko **New registration / Nová registrace**.

Pokud se objeví „nemáš přístup“, požadavek na vytvoření adresáře/tenant,
nebo omezení osobního účtu, zde zastav postup. Poskytni pouze text chyby.
Nekupuj kvůli portálu Azure ani Entra licenci a nezakládej placené prostředky.

Microsoft pro svůj registrační postup uvádí Azure účet s aktivním předplatným,
tenant a potřebná oprávnění. Nabízí i vytvoření bezplatného Azure účtu, ale dostupnost
registrace je nutné ověřit pro konkrétní účet. Tento návod nepředpokládá,
že osobní účet s OneDrivem tyto podmínky automaticky splňuje.
Účet, ve kterém je registrace vytvořená, může být jiný než osobní účet,
jehož OneDrive připojíš později; aplikace však musí podporovat osobní Microsoft účty.

[Microsoft: registrace aplikace](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app),
[Microsoft: omezení vytváření tenantů](https://learn.microsoft.com/en-us/entra/fundamentals/create-new-tenant).

## 3. Zaregistruj aplikaci TicketPortal

Pokud předchozí kontrola prošla:

1. Klikni **New registration**.
2. Do **Name** napiš přesně **TicketPortal**.
3. V **Supported account types** vyber **Personal Microsoft accounts only**.
   Pokud tato nabídka není dostupná, zvol variantu podporující organizace
   **a osobní Microsoft účty**. Samotná varianta Single tenant pro toto řešení nestačí.
4. Redirect URI nyní ponech prázdné; doplníš jej po vytvoření Workeru.
5. Klikni **Register**.
6. V Overview zkopíruj **Application (client) ID**. Je to veřejný identifikátor
   podobný 12345678-1234-1234-1234-123456789abc. Není to heslo.

Název TicketPortal je důležitý: Microsoft podle názvu aplikace vytvoří její složku.

## 4. Nastav oprávnění k jediné složce OneDrivu

1. V registrované aplikaci otevři **API permissions**.
2. Klikni **Add a permission → Microsoft Graph → Delegated permissions**.
3. Vyhledej **Files.ReadWrite.AppFolder**, zaškrtni a potvrď **Add permissions**.
4. Pokud je přednastavené **User.Read**, odeber ho; tento portál ho nevyužívá.
5. Nepřidávej Files.ReadWrite ani Files.ReadWrite.All.
6. Oprávnění odsouhlasíš vlastním osobním účtem při připojení v kroku 10.

Server při přihlášení žádá také offline_access, aby mohl oprávnění obnovovat
bez přítomnosti vlastníka. Kolegové se do Microsoftu nepřihlašují.

Microsoft při Files.ReadWrite.AppFolder omezuje aplikaci na její vlastní složku.
Ostatní soubory OneDrivu nejsou dostupné tímto oprávněním.
[Microsoft: složka aplikace](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder).

## 5. Vytvoř klientský secret Microsoftu

1. Otevři **Certificates & secrets → Client secrets**.
2. Klikni **New client secret**.
3. Description: TicketPortal Cloudflare.
4. Vyber nabízenou dobu platnosti a poznamenej si datum vypršení.
5. Po vytvoření zkopíruj sloupec **Value / Hodnota**. Ne sloupec Secret ID.
6. Hodnotu ulož do svého správce hesel. Později ji vložíš jako
   šifrovaný secret MS_CLIENT_SECRET do Cloudflare.

Tuto hodnotu Microsoft ukáže pouze při vytvoření. Nevkládej ji do GitHubu ani do chatu.
Před vypršením bude potřeba vytvořit novou a nahradit ji v Cloudflare.

## 6. Založ bezplatný Worker

1. Otevři [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Vytvoř účet nebo se přihlas a ověř e-mail.
3. V sekci **Workers & Pages** zvol vytvoření aplikace / **Create application**.
4. Vyber připojení existujícího GitHub repozitáře, například **Import a repository**.
   Názvy tlačítek se mohou mírně lišit.
5. Propoj GitHub a při výběru repozitářů povol **jen Ticket-Portal-**.
6. Vyber repozitář **OndraMa/Ticket-Portal-**.
7. Nastav následující údaje:

| Pole | Hodnota |
|---|---|
| Worker / Project name | ticketportal-onedrive |
| Git branch | work/onedrive-cloud-no-turnstile |
| Root directory | cloud/backend |
| Build command | npm install |
| Deploy command | npm run deploy |

8. Použij **Worker** a tarif **Free**. Pokud rozhraní žádá přechod na Paid,
   nepokračuj platbou; zkontroluj, zda jsi vybral Worker a správnou větev.
9. Spusť nasazení a počkej na úspěšný výsledek.
10. Zkopíruj produkční adresu Workeru, například
    https://ticketportal-onedrive.tvoje-jmeno.workers.dev.

První nasazení může uspět i s dosud nevyplněnými hodnotami pro Microsoft.
Portál v této fázi ještě nemůže načítat data.
Durable Object PORTAL a jeho SQLite úložiště vytváří konfigurace automaticky.
Nevytvářej ručně D1, R2 ani starší KV Durable Object.

[Cloudflare: Git build nastavení](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## 7. Doplň veřejné hodnoty a návratovou adresu

V této chvíli mi můžeš poslat **pouze client ID a produkční URL Workeru**.
Podle nich lze doplnit dva připravené konfigurační soubory za tebe.

Pokud to chceš nastavit sám přes web GitHubu:

1. V repozitáři vyber pracovní větev work/onedrive-cloud-no-turnstile.
2. Otevři cloud/backend/wrangler.toml a klikni na tužku.
3. V sekci vars nastav:

~~~toml
PORTAL_ORIGIN = "https://ondrama.github.io"
PUBLIC_URL = "https://ticketportal-onedrive.tvoje-jmeno.workers.dev"
MS_CLIENT_ID = "SEM_PATRI_TVOJE_APPLICATION_CLIENT_ID"
~~~

4. PUBLIC_URL nemá na konci lomítko. Použij skutečnou adresu, nikoli příklad.
5. Ulož změnu do pracovní větve. Cloudflare ji znovu nasadí.
6. V souboru cloud/config.js nastav:

~~~javascript
window.TICKET_CLOUD_API = 'https://ticketportal-onedrive.tvoje-jmeno.workers.dev';
~~~

7. V Entra otevři **Authentication → Add a platform → Web**.
8. Redirect URI nastav na přesnou adresu:
   https://ticketportal-onedrive.tvoje-jmeno.workers.dev/oauth/callback
9. Ulož. Nevol SPA, nepovoluj implicit grant.

PORTAL_ORIGIN obsahuje jen původ webu bez cesty Ticket-Portal-.
PUBLIC_URL a config.js obsahují jen základní adresu Workeru.
Redirect URI jako jediná obsahuje /oauth/callback.

## 8. Vygeneruj heslový hash a tři náhodné klíče

Pomocník cloud/backend/secrets.mjs je již v pracovní větvi.
Nemusíš instalovat program do svého počítače; můžeš jednorázově použít
soukromý GitHub Codespace otevřený v prohlížeči.

GitHub osobním účtům poskytuje bezplatnou kvótu Codespaces. Je to jiná služba
než Cloudflare: před vytvořením ověř zbývající kvótu. Bez platební metody
se po jejím vyčerpání používání blokuje. Pokud už platební metodu máš,
nejprve nastav omezení placeného používání v Billing / Budgets.
Pokud by bylo nutné něco zaplatit, Codespace nevytvářej.
[GitHub: bezplatná kvóta a účtování](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces).

1. V repozitáři vyber pracovní větev.
2. Klikni **Code → Codespaces → Create codespace**. Použij běžnou 2core variantu.
3. V otevřeném webovém editoru zvol **Terminal → New Terminal**.
4. Do terminálu napiš:

~~~sh
node cloud/backend/secrets.mjs
~~~

5. Zadej nové společné heslo portálu, alespoň 14 znaků.
   V tomto pomocníku je zadávané heslo vidět v soukromém terminálu.
6. Pomocník vypíše čtyři hodnoty:

| Název | Účel |
|---|---|
| PORTAL_PASSWORD_HASH | Ověření společného hesla |
| SESSION_SECRET | Podepisování přihlášení |
| TOKEN_ENCRYPTION_KEY | Šifrování oprávnění OneDrivu |
| ADMIN_SETUP_KEY | Samostatný instalační klíč pro vlastníka |

7. Ulož je soukromě do správce hesel. Nikam je necommituj.
8. Po jejich vložení do Cloudflare Codespace ukonči a na github.com/codespaces
   jej smaž. Pro provoz portálu jej nepotřebuješ.

Pomocník při generování nevolá Microsoft ani OneDrive. Nespouštěj ho v GitHub Actions,
protože by se výstup dostal do logu sestavení.
Společné heslo, instalační klíč a Microsoft secret jsou tři různé věci.

## 9. Vlož pět secrets do Cloudflare

1. Otevři Cloudflare → Workers & Pages → ticketportal-onedrive.
2. Otevři **Settings → Variables and Secrets**.
3. Přidej následující hodnoty jako **Secret / šifrované hodnoty**:

| Název | Co vložit |
|---|---|
| MS_CLIENT_SECRET | Value z Microsoft Certificates & secrets |
| PORTAL_PASSWORD_HASH | Výstup pomocníka stejného názvu |
| SESSION_SECRET | Výstup pomocníka stejného názvu |
| TOKEN_ENCRYPTION_KEY | Výstup pomocníka stejného názvu |
| ADMIN_SETUP_KEY | Výstup pomocníka stejného názvu |

4. Vkládej jen hodnotu za znakem =, nikoli celý řádek s názvem.
5. Potvrď Save / Deploy podle nabídky rozhraní.
6. Nevkládej je do **Build variables**: tam nejsou dostupné za běhu serveru.
7. Ověř, že poslední nasazení je aktivní a tarif zůstává Free.

[Cloudflare: secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## 10. Připoj svůj osobní OneDrive

1. Otevři produkční adresu Workeru s cestou /admin:
   https://ticketportal-onedrive.tvoje-jmeno.workers.dev/admin
2. Do pole zadej **ADMIN_SETUP_KEY**, ne společné heslo kolegů.
3. Klikni **Připojit OneDrive**.
4. Microsoft zobrazí přihlášení. Vyber osobní účet, na kterém máš OneDrive 100 GB.
5. Odsouhlas přístup aplikace TicketPortal k její složce.
6. Po úspěšném návratu uvidíš zprávu **OneDrive je připojen**.

Toto přihlášení provádí vlastník. Kolegové jej nepotřebují.

## 11. Zkopíruj dosavadní Data

1. Otevři [OneDrive](https://onedrive.live.com/) svým osobním účtem.
2. Vyhledej složku **Apps / TicketPortal**, případně **Aplikace / TicketPortal**.
   Vznikne automaticky po úspěšném připojení.
3. Nahraj nebo zkopíruj přímo do této složky:
   servisni.json, dily.json a všechny složky SERV_* s jejich přílohami.
4. Nevkládej tam ještě jednu nadřazenou složku Data.
5. Zachovej přesné názvy souborů i složek.
6. Počkej na dokončení přenosu všech příloh.
7. Původní složku Data ponech jako zálohu.
8. Veřejné sdílení „kdokoli s odkazem“ nezapínej.

Očekávaná struktura:

~~~text
Apps/
  TicketPortal/
    servisni.json
    dily.json
    SERV_RS11_.../
      fotografie.jpg
      dokument.pdf
    SERV_P40_.../
      ...
~~~

Novou cloudovou stránku poprvé použij až po dokončení této migrace.
Po prvním uložení vznikne portal-state.json, který obsahuje aktuální záznamy i díly.
Původní dva JSON soubory se dál nepřepisují; aktuální samostatné JSON získáš exportem
v portálu. Po prvním uložení tedy nepřidávej další záznamy přepisováním původních JSON.

## 12. Zveřejni novou stránku a otestuj ji

Cloudová stránka je nyní pouze v pracovní větvi a draft PR #1.
Dokud větev není publikovaná na GitHub Pages, adresa cloud.html nemusí fungovat.

Po doplnění konfigurace lze připravené změny přenést do main.
Původní index.html se přitom nemění. Pro zachování současného webu
nepřepínej zdroj Pages na pracovní větev jen kvůli testování.

Nová stránka po publikování:
https://ondrama.github.io/Ticket-Portal-/cloud.html

Ověření před používáním kolegy:

1. Zadej společné heslo a porovnej počet záznamů s původním portálem.
2. Otevři starou fotografii i dokument.
3. Vytvoř jeden testovací záznam a zkus přílohu.
4. Uprav jeho sériové číslo a ověř změnu po obnovení stránky.
5. Při editaci vyber dva roboty a ověř dva samostatné záznamy.
6. Otevři stránku v jiném prohlížeči nebo anonymním okně.
   Musí stačit společné heslo, bez Microsoft přihlášení a bez výběru složky.
7. Současně otevři dvě relace. Ulož změnu v první a potom ve druhé:
   druhá má oznámit konflikt a požadovat obnovení, nikoli přepsat novější data.
8. Ověř, že odhlášení opět zobrazí přihlašovací formulář.

## 13. Časté chyby

| Chyba / situace | Co zkontrolovat |
|---|---|
| Cloud ještě není připojen | URL v cloud/config.js a publikování této verze |
| Vlastník musí připojit OneDrive | Projdi /admin; souhlas ještě neproběhl |
| Nepovolený původ | PORTAL_ORIGIN musí být https://ondrama.github.io |
| Redirect URI mismatch / AADSTS50011 | V Entra musí být přesná produkční URL včetně /oauth/callback |
| Nesprávný instalační klíč | Na /admin patří ADMIN_SETUP_KEY |
| Nesprávné heslo | Na cloud.html patří společné heslo zadané do pomocníka |
| Příliš mnoho pokusů | Počkej 15 minut; nezkoušej heslo stále dokola |
| Prázdná historie | Data musí být přímo v Apps/TicketPortal; zkontroluj portal-state.json |
| Záznamy jsou vidět, přílohy ne | Porovnej jména SERV_* složek a příloh s původními daty |
| Jiný kolega změnil data | Obnov stránku, pak změnu zopakuj |
| OneDrive vyžaduje nové připojení | Ověř expiraci MS_CLIENT_SECRET a znovu projdi /admin |
| Cloudflare nabízí placený tarif | Neaktivuj jej; ověř Free a SQLite Durable Object konfiguraci |

## Co můžeš poslat pro dokončení

Bezpečně lze poskytnout Application (client) ID, veřejnou produkční URL Workeru
a případný text chyby bez citlivých hodnot. Podle nich lze doplnit veřejnou konfiguraci.

Do chatu neposílej Microsoft heslo, klientský secret, obnovovací token,
instalační klíč ani společné heslo. Složku OneDrivu není nutné veřejně sdílet.

Další provoz: kolegové otevřou cloud.html a zadají heslo; Codespaces se nepoužívá,
počítač vlastníka nemusí běžet. Vlastník pouze hlídá platnost Microsoft secretu,
případné obnovení souhlasu a zálohy.
