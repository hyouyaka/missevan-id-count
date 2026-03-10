export async function getDramaInfo(id){

    const response =
    await fetch("http://localhost:3000/api/mdrama/" + id)

    const data = await response.json()

    return data
}