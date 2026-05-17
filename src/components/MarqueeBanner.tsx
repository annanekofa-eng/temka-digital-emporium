interface Props {
  text: string;
}

const MarqueeBanner = ({ text }: Props) => {
  if (!text) return null;
  const items = Array.from({ length: 4 }, (_, i) => (
    <span key={i} className="mx-8 whitespace-nowrap text-sm font-medium tracking-wide">
      {text}
    </span>
  ));
  return (
    <div className="overflow-hidden bg-white text-black py-2 border-y border-border/30">
      <div className="flex animate-[marquee_30s_linear_infinite] w-max">
        {items}
        {items}
      </div>
    </div>
  );
};

export default MarqueeBanner;
