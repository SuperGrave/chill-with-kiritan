import json
import os

json_path = "output/vrm_data.json"

with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

vrm_path = r"C:\Users\super\Desktop_Folders\制作\01_素材・アセット\きりたん素材\ふらすこ式風きりたん_VRM_1_0_1\ふらすこ式風きりたん_VRM_1_0_1.vrm"

stats = {
    "fileSize": os.path.getsize(vrm_path),
    "meshCount": len(data.get("meshes", [])),
    "primitiveCount": sum(len(m.get("primitives", [])) for m in data.get("meshes", [])),
    "materialCount": len(data.get("materials", [])),
    "textureCount": len(data.get("textures", [])),
    "imageCount": len(data.get("images", [])),
    "nodeCount": len(data.get("nodes", [])),
    "skinCount": len(data.get("skins", [])),
    "jointCount": sum(len(s.get("joints", [])) for s in data.get("skins", [])),
    "morphTargetCount": sum(len(p.get("targets", [])) for m in data.get("meshes", []) for p in m.get("primitives", [])),
    "skinnedMeshCount": sum(1 for n in data.get("nodes", []) if "mesh" in n and "skin" in n),
    "extensionsUsed": data.get("extensionsUsed", []),
    "asset": data.get("asset", {})
}

output = {
    "stats": stats,
    "extensions": data.get("extensions", {})
}

with open("output/audit_raw.json", "w", encoding='utf-8') as out:
    json.dump(output, out, ensure_ascii=False, indent=2)

print("Saved output/audit_raw.json")
