from __future__ import annotations

from sqlmodel import Session, select

from app.models import Config, Job

DEMO_JOB_NAMES = {
    "my_character_lora",
    "style_transfer_v2",
    "portrait_lora",
}


def seed_data(session: Session) -> None:
    existing_jobs = session.exec(select(Job)).all()
    demo_jobs = [job for job in existing_jobs if job.name in DEMO_JOB_NAMES]
    if len(demo_jobs) == len(existing_jobs) and demo_jobs:
        for job in demo_jobs:
            session.delete(job)
        session.commit()

    has_config = session.exec(select(Config.id)).first()
    if has_config is None:
        config = Config(
            name="sdxl_1024_base",
            model_path="/mnt/models/sdxl/sd_xl_base_1.0.safetensors",
            sample_prompts=[
                {
                    "prompt": "a portrait of a woman, cinematic lighting, photorealistic",
                    "width": 1024,
                    "height": 1024,
                    "seed": 42,
                    "lora_scale": 1.0,
                }
            ],
        )
        session.add(config)

    session.commit()
