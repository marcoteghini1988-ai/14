// Proiezione della Gatling: usa la sagoma estratta DAL PNG della carta approvata.
// Il rendering 3D anima la texture originale, non costruisce una torretta diversa.
import * as THREE from 'three';
import { playSound } from './audio';
import './gatlingHologram.css';

const cardLevel = value => Math.max(1, Math.min(4, Math.round(Number(value) || 1)));

// La sorgente è SEMPRE la carta dell'arma equipaggiata sul lato che sta sparando.
// Non ripiegare su uno slot estraneo: altrimenti la proiezione partirebbe dalla carta sbagliata.
function findCardSlot(weapon, enemy) {
  const selector = enemy ? '[data-enemy-weapon-slot]' : '[data-player-weapon-slot]';
  const slots = [...document.querySelectorAll(selector)];
  const weaponId = weapon?.id || weapon?.weaponId;
  const targetIndex = Number(weapon?.slotIdx ?? weapon?.slotIndex);
  if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < 4) {
    const matchingIndex = slots.find(el => Number(el.dataset.weaponSlotIndex) === targetIndex && el.dataset.weaponId === weaponId);
    if (matchingIndex) return matchingIndex;
  }
  return slots.find(el => el.dataset.weaponId === weaponId) || null;
}

export function projectGatlingHologram(weapon, passedLevel, { targetDockId, targetX, targetY, isEnemyAttacking = false, onComplete } = {}) {
  if (typeof document === 'undefined') { onComplete?.(); return false; }
  const source = findCardSlot(weapon, isEnemyAttacking);
  if (!source) return false;

  // Preleva lo stesso livello raffigurato sullo slot, anche se lo stato cambia durante l'attacco.
  const level = cardLevel(source.dataset.weaponLevel || passedLevel);
  const imageSrc = `/assets/weapons/gatling_holo_lv${level}.png`;
  const sourceBox = source.getBoundingClientRect();
  const originX = sourceBox.left + sourceBox.width / 2;
  const originY = sourceBox.top + sourceBox.height / 2;
  const target = document.getElementById(targetDockId);
  const targetBox = target?.getBoundingClientRect();
  const tx = Number.isFinite(targetX) ? targetX : (targetBox ? targetBox.left + targetBox.width / 2 : window.innerWidth / 2);
  const ty = Number.isFinite(targetY) ? targetY : (targetBox ? targetBox.top + targetBox.height / 2 : window.innerHeight / 2);

  const width = Math.max(124, Math.min(196, window.innerWidth * 0.34));
  const height = width * 0.99;
  // L'ancoraggio resta la posizione esatta della carta dello slot selezionato.
  const left = originX - width / 2;
  const top = isEnemyAttacking ? originY + sourceBox.height * 0.40 : originY - height - sourceBox.height * 0.30;
  const hue = isEnemyAttacking ? '#ff738c' : '#52e9ff';
  const host = document.createElement('div');
  host.className = `gatling-holo-host ${isEnemyAttacking ? 'enemy' : 'player'}`;
  host.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;--holo:${hue}`;
  const platform = document.createElement('div');
  platform.className = 'gatling-holo-platform';
  const scans = document.createElement('div');
  scans.className = 'gatling-holo-scans';
  const label = document.createElement('div');
  label.className = 'gatling-holo-caption';
  label.textContent = `GATLING · LV ${level}`;
  host.append(platform, scans, label);
  document.body.appendChild(host);
  source.classList.add('gatling-holo-source');

  let renderer, scene, camera, imagePlanes, activeFrame, texture;
  let complete = false;
  let lastShot = 0;
  let fired = 0;
  const shots = [];
  const started = performance.now();
  const fxDuration = 2500;
  const finish = () => {
    if (complete) return;
    complete = true;
    if (activeFrame) cancelAnimationFrame(activeFrame);
    shots.forEach(s => s.remove());
    source.classList.remove('gatling-holo-source');
    texture?.dispose();
    if (scene) {
      scene.traverse(obj => {
        if (obj.isMesh) {
          obj.geometry?.dispose();
          // Shared texture is disposed once, above.
          obj.material?.dispose();
        }
      });
    }
    if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
    host.remove();
    onComplete?.();
  };
  const shoot = (t) => {
    // I proiettili partono dal bordo anteriore del disegno estratto, verso l'HP del nemico.
    const sx = left + width * 0.78;
    const sy = top + height * 0.35;
    const bullet = document.createElement('div');
    bullet.className = 'gatling-holo-bullet';
    bullet.style.cssText = `left:${sx}px;top:${sy}px;--shot:${hue}`;
    document.body.appendChild(bullet);
    shots.push(bullet);
    const dx = tx - sx;
    const dy = ty - sy;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const animation = bullet.animate([
      { transform: `rotate(${angle}deg) scaleX(.6)`, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${angle}deg) scaleX(1.2)`, opacity: 1 }
    ], { duration: 310, easing: 'ease-in', fill: 'forwards' });
    animation.onfinish = () => {
      bullet.remove();
      const idx = shots.indexOf(bullet); if (idx >= 0) shots.splice(idx, 1);
      target?.classList.add('bar-hit-flash', 'bar-shiver');
      setTimeout(() => target?.classList.remove('bar-hit-flash', 'bar-shiver'), 130);
    };
    try { playSound('plasma_damage'); } catch (_) {}
    fired++;
    lastShot = t;
  };
  const fallback = () => {
    // WebGL non disponibile: mostra comunque L'ARMA CORRETTA dal PNG trasparente.
    renderer?.dispose(); renderer?.domElement?.remove(); renderer = null;
    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = `Gatling Cinetica livello ${level}`;
    img.className = 'gatling-holo-fallback-art';
    host.appendChild(img);
    let fallbackFrame;
    const loop = t => {
      if (complete) return;
      const elapsed = t - started;
      if (elapsed > 650 && elapsed < 1760 && t - lastShot > 150) shoot(t);
      if (elapsed >= fxDuration) { finish(); return; }
      fallbackFrame = requestAnimationFrame(loop);
      activeFrame = fallbackFrame;
    };
    activeFrame = requestAnimationFrame(loop);
  };
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    renderer.setClearColor(0, 0);
    renderer.domElement.className = 'gatling-holo-canvas';
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(37, width / height, .1, 30);
    camera.position.set(0, .1, 7.3);
    camera.lookAt(0, 0, 0);
    const loader = new THREE.TextureLoader();
    texture = loader.load(imageSrc, undefined, undefined, () => {
      if (!complete) { finish(); }
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    const planes = new THREE.Group();
    scene.add(planes);
    const transparentArt = new THREE.PlaneGeometry(3.65, 3.35);
    const front = new THREE.Mesh(transparentArt, new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: .94, side: THREE.DoubleSide, depthWrite: false }));
    planes.add(front);
    const aura = new THREE.Mesh(new THREE.PlaneGeometry(3.73, 3.42), new THREE.MeshBasicMaterial({ map: texture, color: isEnemyAttacking ? 0xff5a92 : 0x28ddff, transparent: true, opacity: .24, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    aura.position.z = -.12;
    planes.add(aura);
    imagePlanes = planes;
    let shotsAt = 0;
    const draw = (time) => {
      if (complete) return;
      const elapsed = time - started;
      const appear = Math.min(1, elapsed / 380);
      const fade = Math.min(1, (fxDuration - elapsed) / 340);
      const visibility = Math.max(0, appear * fade);
      imagePlanes.scale.setScalar(.55 + visibility * .45);
      imagePlanes.rotation.y = Math.sin(elapsed * .0018) * .16;
      imagePlanes.rotation.z = Math.sin(elapsed * .0024) * .025;
      imagePlanes.position.y = -.08 + Math.sin(elapsed * .0031) * .085;
      front.material.opacity = .94 * visibility;
      aura.material.opacity = (.20 + .08 * Math.sin(elapsed * .009)) * visibility;
      if (elapsed > 640 && elapsed < 1770 && time - shotsAt > 145) {
        shoot(time); shotsAt = time;
      }
      renderer.render(scene, camera);
      if (elapsed >= fxDuration) { finish(); return; }
      activeFrame = requestAnimationFrame(draw);
    };
    activeFrame = requestAnimationFrame(draw);
  } catch(err) {
    console.warn('Proiezione Gatling: WebGL non disponibile, uso PNG originale.', err);
    fallback();
  }
  return true;
}
