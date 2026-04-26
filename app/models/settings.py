from sqlmodel import Field, SQLModel


class AppSettings(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    model_root: str = ""
    lora_root: str = ""
    output_root: str = ""
    dataset_root: str = ""


class AppSettingsRead(SQLModel):
    model_root: str
    lora_root: str
    output_root: str
    dataset_root: str


class AppSettingsUpdate(SQLModel):
    model_root: str = ""
    lora_root: str = ""
    output_root: str = ""
    dataset_root: str = ""
