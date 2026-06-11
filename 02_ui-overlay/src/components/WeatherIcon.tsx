import React from 'react';
import { 
  Cloud, 
  Sun, 
  CloudRain, 
  Snowflake, 
  Wind, 
  Droplets, 
  Gauge, 
  SunDim, 
  Sunrise, 
  Sunset, 
  Clock 
} from 'lucide-react';

export type WeatherIconType = 
  | "cloudy" 
  | "sunny" 
  | "rain" 
  | "snow" 
  | "wind" 
  | "humidity" 
  | "pressure" 
  | "uv" 
  | "sunrise" 
  | "sunset" 
  | "updated";

interface WeatherIconProps {
  type: WeatherIconType | string;
  size?: number;
  opacity?: number;
  color?: string;
  className?: string;
}

const WeatherIcon: React.FC<WeatherIconProps> = ({ 
  type, 
  size = 24, 
  opacity = 1, 
  color = "currentColor",
  className = ""
}) => {
  const iconProps = { size, color, opacity, strokeWidth: 1.5, className };

  const normalizedType = type.toLowerCase();

  switch (normalizedType) {
    case "cloudy":
      return <Cloud {...iconProps} />;
    case "sunny":
    case "clear":
      return <Sun {...iconProps} />;
    case "rain":
    case "rainy":
      return <CloudRain {...iconProps} />;
    case "snow":
    case "snowy":
      return <Snowflake {...iconProps} />;
    case "wind":
      return <Wind {...iconProps} />;
    case "humidity":
      return <Droplets {...iconProps} />;
    case "pressure":
      return <Gauge {...iconProps} />;
    case "uv":
      return <SunDim {...iconProps} />;
    case "sunrise":
      return <Sunrise {...iconProps} />;
    case "sunset":
      return <Sunset {...iconProps} />;
    case "updated":
      return <Clock {...iconProps} />;
    default:
      // Fallback
      return <Cloud {...iconProps} />;
  }
};

export default WeatherIcon;
