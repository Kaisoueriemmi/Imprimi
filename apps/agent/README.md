# PrintBox agent (PC Windows de la borne)

L'agent tourne comme **service Windows** sur le PC relié à l'imprimante et au monnayeur. Il se
connecte **vers** l'API (aucun port à ouvrir dans la boutique), reçoit les travaux payés, les
imprime avec SumatraPDF, pilote le monnayeur et renvoie les statuts.

## Installation pas à pas

1. **Imprimante** : installez-la pour tous les utilisateurs (session administrateur), puis
   notez son nom exact :
   ```powershell
   .\printbox-agent.exe printers
   ```
2. **Clé de la borne** : à la création de la borne (seed ou dashboard admin), l'API affiche une
   seule fois la clé d'agent `pbk_…`.
3. **Configuration** : copiez `agent.config.example.json` en `agent.config.json` à côté de
   `printbox-agent.exe` et remplissez `apiUrl`, `kioskId`, `apiKey`, `printerName`. Vérifiez :
   ```powershell
   .\printbox-agent.exe check-config --config .\agent.config.json
   ```
4. **Page de test** :
   ```powershell
   .\printbox-agent.exe test-print --config .\agent.config.json
   ```
   Au premier lancement, SumatraPDF portable (version épinglée, SHA-256 vérifié) est téléchargé
   dans `data\sumatra`.
5. **Service** (PowerShell **en administrateur**, dans le dossier de la release) :
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\install-agent.ps1
   ```
   Le service `PrintBoxAgent` démarre avec Windows et redémarre tout seul en cas d'arrêt.
   Fichiers : `C:\Program Files\PrintBox` (accès limité à SYSTEM et Administrateurs, car la
   configuration contient la clé). Journaux : `C:\Program Files\PrintBox\logs`.

Mise à jour : relancer `install-agent.ps1` avec le nouvel exécutable. Désinstallation :
`uninstall-agent.ps1` (ajouter `-RemoveFiles` pour tout supprimer).

## Configuration

| Clé                        | Rôle                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `apiUrl`                   | URL de l'API (HTTPS en production)                                     |
| `kioskId`, `apiKey`        | identité de la borne                                                   |
| `printerName`              | nom Windows exact de l'imprimante                                      |
| `printer`                  | `windows` (SumatraPDF) ou `fake` (écrit les PDF dans `data/out`)       |
| `sumatraPath`              | facultatif : SumatraPDF.exe déjà installé                              |
| `dataDir`                  | file d'envoi, registre, PDF temporaires (relatif au fichier de config) |
| `coinDevice.driver`        | `none`, `simulated` ou `cctalk` (matériel à choisir, pas encore codé)  |
| `coinDevice.simulatorPort` | port local du simulateur de monnayeur (127.0.0.1 uniquement)           |
| `logLevel`                 | `info` par défaut                                                      |

## Commandes

```
printbox-agent run            # ce que lance le service
printbox-agent test-print     # page de test
printbox-agent printers       # imprimantes Windows
printbox-agent check-config   # valide agent.config.json
printbox-agent simulate-coin 500   # insère 0,500 DT dans le monnayeur simulé
printbox-agent version
```

## Fiabilité

- **File d'envoi persistante** (`data/outbox.json`) : statuts d'impression et pièces sont écrits
  sur disque avant tout, puis renvoyés jusqu'à accusé de réception. Une coupure réseau ou un
  redémarrage ne perd ni un statut ni une pièce.
- **Registre** (`data/ledger.json`) : un travail imprimé n'est jamais réimprimé ; un travail
  interrompu par un redémarrage est signalé en échec (l'opérateur peut le réimprimer) plutôt
  qu'imprimé deux fois ; un rendu de monnaie n'est exécuté qu'une fois.
- Les PDF locaux (`data/work`) sont supprimés après chaque impression, même en cas d'erreur, et
  au démarrage.
- Reconnexion automatique (1 s → 30 s). Heartbeat toutes les 15 s : état de l'imprimante,
  monnayeur, espace disque, version.

## Développement

```bash
pnpm --filter @printbox/agent dev -- run --config ./agent.config.json   # printer "fake" conseillé
pnpm --filter @printbox/agent test
pnpm --filter @printbox/agent package    # bin/printbox-agent.exe (Node ≥ 22 pour construire)
```

## Écran de la borne (Chrome en mode kiosque)

Sur le même PC, l'écran affiche le QR code, les instructions en français, arabe et anglais, la
file d'impression et le paiement en pièces en cours. Avec la session Windows qui s'ouvre
automatiquement sur la borne (pas en administrateur) :

```powershell
.\install-kiosk-screen.ps1 -WebUrl https://print.example.tn -KioskId demo-kiosk -DisplayKey pbd_...
```

Chrome s'ouvre alors en plein écran à chaque ouverture de session (Alt+F4 pour en sortir).
La clé d'écran `pbd_…` est **différente** de la clé d'agent `pbk_…` : elle ne permet que
d'afficher l'écran et de générer le QR code. Elle passe dans le fragment d'URL (`#key=…`), que
le navigateur n'envoie jamais au serveur, puis est mémorisée dans le profil Chrome dédié.

L'écran se met à jour en direct, affiche « Hors service » si l'agent est déconnecté (ou
l'imprimante / le monnayeur en erreur, ou l'API injoignable plus de 30 s), garde le moniteur
allumé et se recharge seul chaque nuit à 4 h.
