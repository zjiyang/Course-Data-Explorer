// Centralized Chart.js component registration (tree-shaken build, unlike the
// legacy CDN-loaded chart.umd.min.js which registered everything).
import { BarElement, CategoryScale, Chart, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip } from "chart.js";

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip, Legend);
