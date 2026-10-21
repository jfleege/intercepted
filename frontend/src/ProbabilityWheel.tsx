import { TEAM_COLORS } from "./teams";

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

type ProbabilityWheelProps = {
  awayTeam: string;
  homeTeam: string;
  homeProb: number;
};

export default function ProbabilityWheel({
  awayTeam,
  homeTeam,
  homeProb,
}: ProbabilityWheelProps) {
  const awayProb = 1 - homeProb;
  const winnerIsHome = homeProb >= 0.5;

  const winnerTeam = winnerIsHome ? homeTeam : awayTeam;
  const winnerProb = winnerIsHome ? homeProb : awayProb;
  const winnerColor = TEAM_COLORS[winnerTeam] ?? "#187be8";

  const radius = 61;
  const circumference = 2 * Math.PI * radius;
  const coloredLength = circumference * winnerProb;

  return (
    <div className="ga-wheel-block">
      <div className="ga-wheel-side">
        <strong>{awayTeam}</strong>
        <span className={winnerIsHome ? "" : "ga-favored"}>
          {percent(awayProb)}
        </span>
      </div>

      <div className="ga-wheel-wrap">
        <svg
          className="ga-prob-wheel"
          viewBox="0 0 160 160"
          role="img"
          aria-label={`${awayTeam} ${percent(awayProb)}, ${homeTeam} ${percent(homeProb)}`}
        >
          <defs>
            <pattern
              id="ga-loser-stripes"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <rect width="6" height="6" fill="#f5f7f5" />
              <rect width="2" height="6" fill="#293b48" />
            </pattern>
          </defs>

          {/* striped background ring */}
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="url(#ga-loser-stripes)"
            strokeWidth="16"
          />

          {/* projected winner */}
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={winnerColor}
            strokeWidth="16"
            strokeDasharray={`${coloredLength} ${circumference}`}
            transform={
              winnerIsHome
                ? "rotate(-90 80 80)"
                : "translate(160 0) scale(-1 1) rotate(-90 80 80)"
            }
          />
        </svg>

        <div className="ga-wheel-center">
          <img
            src={`${import.meta.env.BASE_URL}logos/${awayTeam}.png`}
            alt={awayTeam}
          />

          <div className="ga-wheel-divider" />

          <img
            src={`${import.meta.env.BASE_URL}logos/${homeTeam}.png`}
            alt={homeTeam}
          />
        </div>
      </div>

      <div className="ga-wheel-side">
        <strong>{homeTeam}</strong>
        <span className={winnerIsHome ? "ga-favored" : ""}>
          {percent(homeProb)}
        </span>
      </div>
    </div>
  );
}
