/** 32 px PixelLab icons (public/icons), always drawn at a whole-number scale. */
export function Icon({ name, size = 32, title }: { name: string; size?: 16 | 32 | 64; title?: string }) {
  return (
    <img className="ico" src={`${import.meta.env.BASE_URL}icons/${name}.png`} width={size} height={size} alt={title ?? name}
      title={title} style={{ imageRendering: 'pixelated', verticalAlign: 'middle' }} draggable={false} />
  )
}
