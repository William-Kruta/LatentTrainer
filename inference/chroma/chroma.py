import torch
from diffusers import ChromaPipeline, ChromaTransformer2DModel

path = ""

transformer = ChromaTransformer2DModel.from_single_file(path, torch_dtype=dtype)

pipe = ChromaPipeline.from_pretrained(
    model_id, transformer=transformer, torch_dtype=dtype
)

pipe.to("cuda")

pipe.enable_vae_tiling()
pipe.enable_vae_slicing()

pos_prompt = ""
neg_prompt = ""
image = pipe(
    prompt=prompt,
    negative_prompt=neg_prompt,
    num_inference_steps=40,
    guidance_scale=3.0,
    width=1024,
    height=1024,
    generator=torch.Generator(device="cuda").manual_seed(42),
).images[0]

image.save("test.png")
