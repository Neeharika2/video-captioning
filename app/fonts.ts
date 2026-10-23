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
  Anton,
  Archivo_Black,
  Audiowide,
  Bangers,
  Bowlby_One_SC,
  Bungee,
  Chewy,
  DM_Serif_Display,
  Inter,
  Lilita_One,
  Monoton,
  Montserrat,
  Permanent_Marker,
  Poppins,
  Righteous,
  Syne,
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

/**
 * Applied once on the root layout so next/font emits the self-hosted
 * `@font-face` rules for every caption face.
 */
export const captionFontVariables = [
  inter,
  poppins,
  montserrat,
  bungee,
  archivoBlack,
  bowlbyOne,
  permanentMarker,
  lilitaOne,
  righteous,
  audiowide,
  syne,
  dmSerifDisplay,
  monoton,
  anton,
  bangers,
  chewy,
]
  .map((font) => font.variable)
  .join(" ");
