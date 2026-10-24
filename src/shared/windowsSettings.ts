// Windows Settings pages reachable through documented ms-settings: URIs.
// Keywords are bilingual so either language finds the page.

export interface WinSetting {
  uri: string;
  fr: string;
  en: string;
  keywords: string;
}

export const WINDOWS_SETTINGS: WinSetting[] = [
  { uri: 'ms-settings:display', fr: 'Écran', en: 'Display', keywords: 'luminosite brightness resolution echelle scale hdr ecran moniteur monitor' },
  { uri: 'ms-settings:nightlight', fr: 'Éclairage nocturne', en: 'Night light', keywords: 'lumiere bleue blue light nuit night' },
  { uri: 'ms-settings:sound', fr: 'Son', en: 'Sound', keywords: 'audio volume sortie output haut-parleur speaker micro microphone' },
  { uri: 'ms-settings:notifications', fr: 'Notifications', en: 'Notifications', keywords: 'alertes alerts' },
  { uri: 'ms-settings:quiethours', fr: 'Concentration / Ne pas déranger', en: 'Focus / Do not disturb', keywords: 'focus concentration ne pas deranger do not disturb' },
  { uri: 'ms-settings:powersleep', fr: 'Alimentation et batterie', en: 'Power & battery', keywords: 'energie power batterie battery veille sleep economie saver' },
  { uri: 'ms-settings:batterysaver', fr: 'Économiseur de batterie', en: 'Battery saver', keywords: 'batterie battery economie saver' },
  { uri: 'ms-settings:storagesense', fr: 'Stockage', en: 'Storage', keywords: 'disque disk espace space nettoyage cleanup' },
  { uri: 'ms-settings:multitasking', fr: 'Multitâche', en: 'Multitasking', keywords: 'snap ancrage fenetres windows bureaux virtuels virtual desktops alt tab' },
  { uri: 'ms-settings:clipboard', fr: 'Presse-papiers', en: 'Clipboard', keywords: 'copier coller copy paste historique history' },
  { uri: 'ms-settings:about', fr: 'Informations système', en: 'About', keywords: 'systeme system pc nom name version specifications' },
  { uri: 'ms-settings:bluetooth', fr: 'Bluetooth et appareils', en: 'Bluetooth & devices', keywords: 'bluetooth appareils devices casque headphones souris mouse' },
  { uri: 'ms-settings:printers', fr: 'Imprimantes et scanners', en: 'Printers & scanners', keywords: 'imprimante printer scanner' },
  { uri: 'ms-settings:mousetouchpad', fr: 'Souris', en: 'Mouse', keywords: 'souris mouse pointeur pointer defilement scroll' },
  { uri: 'ms-settings:devices-touchpad', fr: 'Pavé tactile', en: 'Touchpad', keywords: 'touchpad pave tactile gestes gestures' },
  { uri: 'ms-settings:typing', fr: 'Saisie', en: 'Typing', keywords: 'clavier keyboard correction autocorrect' },
  { uri: 'ms-settings:network-status', fr: 'Réseau et Internet', en: 'Network & internet', keywords: 'reseau network internet connexion connection ethernet' },
  { uri: 'ms-settings:network-wifi', fr: 'Wi-Fi', en: 'Wi-Fi', keywords: 'wifi wi-fi sans fil wireless' },
  { uri: 'ms-settings:network-vpn', fr: 'VPN', en: 'VPN', keywords: 'vpn' },
  { uri: 'ms-settings:network-airplanemode', fr: 'Mode Avion', en: 'Airplane mode', keywords: 'avion airplane' },
  { uri: 'ms-settings:network-mobilehotspot', fr: 'Point d’accès mobile', en: 'Mobile hotspot', keywords: 'hotspot partage connexion tethering' },
  { uri: 'ms-settings:personalization', fr: 'Personnalisation', en: 'Personalization', keywords: 'personnaliser customize apparence' },
  { uri: 'ms-settings:personalization-background', fr: 'Arrière-plan', en: 'Background', keywords: 'fond ecran wallpaper background image' },
  { uri: 'ms-settings:colors', fr: 'Couleurs', en: 'Colors', keywords: 'couleur color mode sombre dark clair light accent theme' },
  { uri: 'ms-settings:themes', fr: 'Thèmes', en: 'Themes', keywords: 'theme' },
  { uri: 'ms-settings:lockscreen', fr: 'Écran de verrouillage', en: 'Lock screen', keywords: 'verrouillage lock' },
  { uri: 'ms-settings:taskbar', fr: 'Barre des tâches', en: 'Taskbar', keywords: 'barre taches taskbar masquer hide' },
  { uri: 'ms-settings:fonts', fr: 'Polices', en: 'Fonts', keywords: 'police font' },
  { uri: 'ms-settings:appsfeatures', fr: 'Applications installées', en: 'Installed apps', keywords: 'desinstaller uninstall programmes programs apps' },
  { uri: 'ms-settings:defaultapps', fr: 'Applications par défaut', en: 'Default apps', keywords: 'defaut default navigateur browser ouvrir avec' },
  { uri: 'ms-settings:startupapps', fr: 'Applications de démarrage', en: 'Startup apps', keywords: 'demarrage startup' },
  { uri: 'ms-settings:yourinfo', fr: 'Vos informations', en: 'Your info', keywords: 'compte account profil profile' },
  { uri: 'ms-settings:signinoptions', fr: 'Options de connexion', en: 'Sign-in options', keywords: 'mot de passe password pin hello empreinte fingerprint' },
  { uri: 'ms-settings:dateandtime', fr: 'Date et heure', en: 'Date & time', keywords: 'date heure time fuseau timezone horloge clock' },
  { uri: 'ms-settings:regionlanguage', fr: 'Langue et région', en: 'Language & region', keywords: 'langue language region clavier keyboard' },
  { uri: 'ms-settings:gaming-gamebar', fr: 'Game Bar', en: 'Game Bar', keywords: 'jeu game xbox capture' },
  { uri: 'ms-settings:gaming-gamemode', fr: 'Mode Jeu', en: 'Game Mode', keywords: 'jeu game performance' },
  { uri: 'ms-settings:easeofaccess', fr: 'Accessibilité', en: 'Accessibility', keywords: 'accessibilite accessibility contraste contrast loupe magnifier narrateur narrator' },
  { uri: 'ms-settings:privacy', fr: 'Confidentialité et sécurité', en: 'Privacy & security', keywords: 'confidentialite privacy securite security permissions' },
  { uri: 'ms-settings:windowsdefender', fr: 'Sécurité Windows', en: 'Windows Security', keywords: 'antivirus defender securite security pare-feu firewall' },
  { uri: 'ms-settings:windowsupdate', fr: 'Windows Update', en: 'Windows Update', keywords: 'mise a jour update' },
  { uri: 'ms-settings:backup', fr: 'Sauvegarde Windows', en: 'Windows Backup', keywords: 'sauvegarde backup onedrive' },
  { uri: 'ms-settings:recovery', fr: 'Récupération', en: 'Recovery', keywords: 'reinitialiser reset recuperation recovery' },
  { uri: 'ms-settings:project', fr: 'Projeter', en: 'Project', keywords: 'projeter project second ecran second screen' },
];
