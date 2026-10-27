/**
 * Self-hosted display faces for captions, loaded through next/font.
 *
 * `preload: false` keeps first paint light: the @font-face rules ship with the
 * build, but a face is only fetched once the preview or the burned-in export
 * actually uses it. The generated family name (e.g. "Bungee") matches the one
 * in `FONT_STACKS`, so DOM preview and canvas export resolve the same face.
 *
 * The loader is a build-time transform: it only accepts literal arguments, so
 * the shared options are repeated rather than spread.
 */
import {
  Amatic_SC,
  Anton,
  Archivo_Black,
  Audiowide,
  Baloo_2,
  Bangers,
  Bebas_Neue,
  Bowlby_One_SC,
  Bungee,
  Caveat,
  Chewy,
  Comfortaa,
  DM_Serif_Display,
  Dancing_Script,
  Fredoka,
  Great_Vibes,
  Indie_Flower,
  Inter,
  Kaushan_Script,
  Lilita_One,
  Lobster,
  Luckiest_Guy,
  Monoton,
  Montserrat,
  Orbitron,
  Oswald,
  Pacifico,
  Permanent_Marker,
  Poppins,
  Press_Start_2P,
  Righteous,
  Russo_One,
  Sacramento,
  Satisfy,
  Shadows_Into_Light,
  Special_Elite,
  Syne,
  Titan_One,
  Varela_Round,
  Yellowtail,
} from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const poppins = Poppins({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
});
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-montserrat" });
const bungee = Bungee({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-bungee" });
const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: "400",
  variable: "--font-archivo-black",
});
const bowlbyOne = Bowlby_One_SC({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: "400",
  variable: "--font-bowlby-one",
});
const permanentMarker = Permanent_Marker({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: "400",
  variable: "--font-permanent-marker",
});
const lilitaOne = Lilita_One({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: "400",
  variable: "--font-lilita-one",
});
const righteous = Righteous({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: "400",
  variable: "--font-righteous",
});
const audiowide = Audiowide({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: "400",
  variable: "--font-audiowide",
});
const syne = Syne({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-syne" });
const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: "400",
  variable: "--font-dm-serif-display",
});
const monoton = Monoton({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: "400",
  variable: "--font-monoton",
});

const anton = Anton({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-anton" });
const bangers = Bangers({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-bangers" });
const chewy = Chewy({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-chewy" });
const oswald = Oswald({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-oswald" });
const bebasNeue = Bebas_Neue({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-bebas-neue" });
const russoOne = Russo_One({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-russo-one" });
const titanOne = Titan_One({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-titan-one" });
const fredoka = Fredoka({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-fredoka" });
const lobster = Lobster({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-lobster" });
const pacifico = Pacifico({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-pacifico" });
const caveat = Caveat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-caveat" });
const dancingScript = Dancing_Script({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-dancing-script" });
const orbitron = Orbitron({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-orbitron" });
const pressStart2P = Press_Start_2P({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-press-start-2p" });
const specialElite = Special_Elite({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-special-elite" });
const greatVibes = Great_Vibes({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-great-vibes" });
const satisfy = Satisfy({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-satisfy" });
const kaushanScript = Kaushan_Script({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-kaushan-script" });
const yellowtail = Yellowtail({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-yellowtail" });
const sacramento = Sacramento({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-sacramento" });
const indieFlower = Indie_Flower({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-indie-flower" });
const amaticSC = Amatic_SC({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-amatic-sc" });
const shadowsIntoLight = Shadows_Into_Light({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-shadows-into-light" });
const comfortaa = Comfortaa({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-comfortaa" });
const baloo = Baloo_2({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-baloo" });
const varelaRound = Varela_Round({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-varela-round" });
const luckiestGuy = Luckiest_Guy({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-luckiest-guy" });

/**
 * Applied once on the root layout so next/font emits the self-hosted
 * `@font-face` rules for every caption face.
 */
export const captionFontVariables = [
  inter,
  poppins,
  montserrat,
  oswald,
  bungee,
  archivoBlack,
  bebasNeue,
  bowlbyOne,
  permanentMarker,
  lilitaOne,
  righteous,
  russoOne,
  titanOne,
  fredoka,
  audiowide,
  syne,
  orbitron,
  dmSerifDisplay,
  monoton,
  anton,
  bangers,
  chewy,
  lobster,
  pacifico,
  caveat,
  dancingScript,
  pressStart2P,
  specialElite,
  greatVibes,
  satisfy,
  kaushanScript,
  yellowtail,
  sacramento,
  indieFlower,
  amaticSC,
  shadowsIntoLight,
  comfortaa,
  baloo,
  varelaRound,
  luckiestGuy,
]
  .map((font) => font.variable)
  .join(" ");
