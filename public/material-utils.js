import * as THREE from './libs/build/three.module.js';

export function toLambert(material) {
  if (!material) return material;
  if (Array.isArray(material)) return material.map(toLambert);
  const lambert = new THREE.MeshLambertMaterial({
    color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
    map: material.map ?? null,
    emissive: material.emissive ? material.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: material.emissiveMap ?? null,
    emissiveIntensity: material.emissiveIntensity ?? 1,
    transparent: material.transparent ?? false,
    opacity: material.opacity ?? 1,
    alphaTest: material.alphaTest ?? 0,
    side: material.side ?? THREE.FrontSide,
    depthWrite: material.depthWrite ?? true,
    depthTest: material.depthTest ?? true,
    fog: material.fog ?? true
  });
  if (material.vertexColors !== undefined) lambert.vertexColors = material.vertexColors;
  if (material.skinning !== undefined) lambert.skinning = material.skinning;
  if (material.morphTargets !== undefined) lambert.morphTargets = material.morphTargets;
  if (material.morphNormals !== undefined) lambert.morphNormals = material.morphNormals;
  return lambert;
}
